import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { ActivityDraft } from '../core/orchestration/activity'
import { healthFileIn, readAutoLimits, readHealthSnapshot, updateAutoLimits, type AutoLimits } from '../core/settings/autoLimits'
import {
  CALM_RAISE_MS,
  COMMIT_STALE_MS,
  LOWER_COOLDOWN_MS,
  SAMPLE_MS,
  PAGEFILE_DISK_MARGIN_GB,
  changeLines,
  commitReadingOf,
  createCommitReader,
  createLoadMonitor,
  isCritical,
  isStrained,
  judge,
  memAvailablePctOfMeminfo,
  reachableCommitLimitKb,
  sampleOf,
  type Caps,
  type CommitSpawn,
  type LiveCounts,
  type PagefileReading,
  type PersonCaps,
  type Readings,
  type Sample
} from './loadMonitor'

const T0 = Date.parse('2026-10-26T12:00:00Z')
const CALM: Omit<Sample, 'at'> = { memAvailablePct: 60, load1PerCpu: 0.5, loopDelayP99Ms: 30 }
const STRAINED: Omit<Sample, 'at'> = { memAvailablePct: 6, load1PerCpu: 3.5, loopDelayP99Ms: 1400 }
const CRITICAL: Omit<Sample, 'at'> = { memAvailablePct: 3, load1PerCpu: 0.5, loopDelayP99Ms: 30 }

/** `kinds` oldest first, the last one at `now`, 10 s apart. */
const run = (now: number, kinds: Array<Omit<Sample, 'at'>>): Sample[] => kinds.map((k, i) => ({ ...k, at: now - (kinds.length - 1 - i) * SAMPLE_MS }))
const strained3 = (now: number): Sample[] => run(now, [STRAINED, STRAINED, STRAINED])
/** 3 minutes and one sample of calm: 19 samples, the first exactly CALM_RAISE_MS before `now`. */
const calmFor3Min = (now: number): Sample[] => run(now, Array(CALM_RAISE_MS / SAMPLE_MS + 1).fill(CALM))

/** The owner allows 25 agents and 3 heavy jobs; 10 agents run. The default floor is ceil(25 / 2) = 13. */
const person: PersonCaps = { workers: 25, heavy: 3 }
const live: LiveCounts = { workers: 10, heavyRunning: 1, checksRunning: 0 }
const none: AutoLimits = { history: [] }
const at = (ms: number): string => new Date(ms).toISOString()
const effectiveOf = (cur: AutoLimits, p: Caps = person): Caps => ({
  workers: Math.min(p.workers, cur.workers?.cap ?? p.workers),
  heavy: Math.min(p.heavy, cur.heavy?.cap ?? p.heavy)
})

/** Strain that never ends: judges a strained run every cooldown, applies each update, and returns the agent caps. */
function persistingStrain(start: AutoLimits, l: LiveCounts, p: PersonCaps, rounds: number): { caps: number[]; stages: string[]; cur: AutoLimits } {
  let cur = start
  const caps: number[] = []
  const stages: string[] = []
  for (let i = 0; i < rounds; i++) {
    const now = T0 + i * (LOWER_COOLDOWN_MS + SAMPLE_MS)
    const u = judge(strained3(now), cur, l, effectiveOf(cur, p), p, now)
    stages.push(u?.stage ?? 'none')
    if (u) cur = u(cur)
    caps.push(effectiveOf(cur, p).workers)
  }
  return { caps, stages, cur }
}

describe('judge: lowering in stages', () => {
  it('first pauses new starts at the agents running, lowers heavy by one and turns checks-as-heavy on', () => {
    const update = judge(strained3(T0), none, live, person, person, T0)!
    expect(update.stage).toBe('pause')
    const next = update(none)
    expect(next.workers).toMatchObject({ cap: 10, cause: 'strain' })
    expect(next.workers!.detail).toBe('memory 6% free, Host loop 1.4 s behind, load 3.5 per CPU while 10 agents ran')
    expect(next.heavy).toMatchObject({ cap: 2, cause: 'strain' })
    expect(next.checksAsHeavy).toMatchObject({ cause: 'strain' })
    expect(next.history.map((h) => [h.what, h.from, h.to, h.cause])).toEqual([
      ['workers', 25, 10, 'strain'],
      ['heavy', 3, 2, 'strain'],
      ['checks', null, null, 'strain']
    ])
  })

  it('never cuts the pause below the agents running: more agents than the cap leaves the cap alone', () => {
    const next = judge(strained3(T0), none, { ...live, workers: 30 }, person, person, T0)!(none)
    expect(next.workers).toBeUndefined()
    expect(next.heavy?.cap).toBe(2)
  })

  it('with 10 agents running and the default floor of 13, persisting strain does not go below the pause', () => {
    const { caps, stages } = persistingStrain(none, live, person, 5)
    expect(caps).toEqual([10, 10, 10, 10, 10])
    // the pause, then heavy 2 -> 1, then nothing left to lower
    expect(stages).toEqual(['pause', 'lower', 'none', 'none', 'none'])
  })

  it('lowers by 2 per stage after the pause, never below the default floor ceil(limit / 2)', () => {
    const { caps, stages } = persistingStrain(none, { ...live, workers: 20 }, person, 7)
    expect(caps).toEqual([20, 18, 16, 14, 13, 13, 13])
    expect(stages.slice(0, 5)).toEqual(['pause', 'lower', 'lower', 'lower', 'lower'])
  })

  it('goes 10 -> 8 -> 6 and stops at a floor the owner set', () => {
    const { caps } = persistingStrain(none, live, { ...person, workersFloor: 4 }, 6)
    expect(caps).toEqual([10, 8, 6, 4, 4, 4])
  })

  it('names the floor on a lowering', () => {
    const cur: AutoLimits = { history: [{ at: at(T0 - 3 * 60_000), what: 'heavy', from: 3, to: 2, cause: 'strain', detail: '' }] }
    const u = judge(strained3(T0), cur, { ...live, workers: 20 }, { workers: 20, heavy: 2 }, person, T0)!
    expect([u.stage, u.floor]).toEqual(['lower', 13])
    expect(u(cur).workers?.cap).toBe(18)
  })

  it('does nothing within 2 minutes of the last lowering, and lowers again after it', () => {
    const lowered = (ago: number): AutoLimits => ({ history: [{ at: at(T0 - ago), what: 'workers', from: 25, to: 20, cause: 'strain', detail: '' }] })
    const eff = { workers: 20, heavy: 3 }
    expect(judge(strained3(T0), lowered(60_000), live, eff, person, T0)).toBeNull()
    expect(judge(strained3(T0), lowered(LOWER_COOLDOWN_MS + 1000), live, eff, person, T0)).not.toBeNull()
  })

  it('lowers after 2 critical samples, and critical strain skips the cooldown but not the floor', () => {
    expect(judge(run(T0, [CALM, CRITICAL, CRITICAL]), none, live, person, person, T0)?.stage).toBe('pause')
    const justLowered: AutoLimits = { history: [{ at: at(T0 - SAMPLE_MS), what: 'workers', from: 16, to: 14, cause: 'strain', detail: '' }] }
    const eff = { workers: 14, heavy: 1 }
    const busy = { ...live, workers: 14 }
    expect(judge(strained3(T0), { ...justLowered, checksAsHeavy: { cause: 'strain', at: at(T0) } }, busy, eff, person, T0)).toBeNull()
    const cur: AutoLimits = { ...justLowered, checksAsHeavy: { cause: 'strain', at: at(T0) } }
    const u = judge(run(T0, [CRITICAL, CRITICAL]), cur, busy, eff, person, T0)!
    expect(u.stage).toBe('lower')
    const next = u(cur)
    expect(next.workers?.cap).toBe(13)
    // At the floor, with heavy at 1 and checks waiting, critical strain has nothing left to lower.
    expect(judge(run(T0 + SAMPLE_MS, [CRITICAL, CRITICAL]), next, busy, { workers: 13, heavy: 1 }, person, T0 + SAMPLE_MS)).toBeNull()
  })

  it('does nothing after 2 strained samples that are not critical, or when the strain is not in a row', () => {
    expect(judge(run(T0, [CALM, STRAINED, STRAINED]), none, live, person, person, T0)).toBeNull()
    expect(judge(run(T0, [STRAINED, CALM, STRAINED, STRAINED]), none, live, person, person, T0)).toBeNull()
  })

  it('leaves the agent cap alone in the pause when no agent runs', () => {
    const idle = judge(strained3(T0), none, { ...live, workers: 0 }, person, person, T0)!(none)
    expect(idle.workers).toBeUndefined()
    expect(idle.heavy?.cap).toBe(2)
  })

  it('moves straight on to lowering when a pause would change nothing', () => {
    const cur: AutoLimits = { history: [], checksAsHeavy: { cause: 'crash', at: at(T0 - 3600_000) } }
    const u = judge(strained3(T0), cur, { ...live, workers: 30 }, { workers: 25, heavy: 1 }, person, T0)!
    expect(u.stage).toBe('lower')
    expect(u(cur).workers?.cap).toBe(23)
  })

  it('pauses again on a new strain after a calm raise', () => {
    const cur: AutoLimits = {
      workers: { cap: 17, cause: 'strain', at: at(T0 - 5 * 60_000), detail: '' },
      history: [
        { at: at(T0 - 9 * 60_000), what: 'workers', from: 15, to: 13, cause: 'strain', detail: '' },
        { at: at(T0 - 5 * 60_000), what: 'workers', from: 13, to: 17, cause: 'calm', detail: '' }
      ]
    }
    const u = judge(strained3(T0), cur, live, { workers: 17, heavy: 3 }, person, T0)!
    expect(u.stage).toBe('pause')
    expect(u(cur).workers?.cap).toBe(10)
  })

  it("keeps the cause of a cap a crash set, so it stays the person's to restore", () => {
    const crash: AutoLimits = { history: [], workers: { cap: 12, cause: 'crash', at: at(T0 - 3600_000), detail: 'x' } }
    const next = judge(strained3(T0), crash, live, { workers: 12, heavy: 3 }, person, T0)!(crash)
    expect(next.workers).toMatchObject({ cap: 10, cause: 'crash' })
  })
})

describe('judge: raising', () => {
  const lowered = (over: Partial<AutoLimits> = {}, ago = CALM_RAISE_MS + 1000): AutoLimits => ({
    workers: { cap: 13, cause: 'strain', at: at(T0 - ago), detail: 'd' },
    heavy: { cap: 1, cause: 'strain', at: at(T0 - ago), detail: 'd' },
    checksAsHeavy: { cause: 'strain', at: at(T0 - ago) },
    history: [{ at: at(T0 - ago), what: 'workers', from: 15, to: 13, cause: 'strain', detail: 'd' }],
    ...over
  })

  it('raises workers by 4, heavy by 1 and clears checks-as-heavy after 3 calm minutes', () => {
    const cur = lowered()
    const u = judge(calmFor3Min(T0), cur, live, { workers: 13, heavy: 1 }, person, T0)!
    expect(u.stage).toBe('raise')
    const next = u(cur)
    expect(next.workers?.cap).toBe(17)
    expect(next.heavy?.cap).toBe(2)
    expect(next.checksAsHeavy).toBeUndefined()
    expect(next.history.slice(-3).every((h) => h.cause === 'calm')).toBe(true)
  })

  it('gets back from the floor to the owner limit in three calm rounds', () => {
    let cur = lowered()
    const caps: Array<number | undefined> = []
    for (let i = 0; i < 4; i++) {
      const now = T0 + i * (CALM_RAISE_MS + SAMPLE_MS)
      const u = judge(calmFor3Min(now), cur, live, effectiveOf(cur), person, now)
      if (u) cur = u(cur)
      caps.push(cur.workers?.cap)
    }
    expect(caps).toEqual([17, 21, undefined, undefined])
  })

  it("removes an entry that reaches the person's own value", () => {
    const cur = lowered({ workers: { cap: 23, cause: 'strain', at: at(T0 - CALM_RAISE_MS - 1000), detail: 'd' } })
    const next = judge(calmFor3Min(T0), cur, live, { workers: 23, heavy: 1 }, person, T0)!(cur)
    expect(next.workers).toBeUndefined()
    expect(next.history.find((h) => h.what === 'workers' && h.cause === 'calm')).toMatchObject({ from: 23, to: 25 })
  })

  it('does nothing before 3 minutes of watching, after a strained sample inside them, or within 3 minutes of the last change', () => {
    const cur = lowered()
    const eff = { workers: 13, heavy: 1 }
    expect(judge(run(T0, Array(CALM_RAISE_MS / SAMPLE_MS).fill(CALM)), cur, live, eff, person, T0)).toBeNull()
    const blip = calmFor3Min(T0)
    blip[5] = { ...blip[5], ...STRAINED }
    expect(judge(blip, cur, live, eff, person, T0)).toBeNull()
    expect(judge(calmFor3Min(T0), lowered({}, 2 * 60_000), live, eff, person, T0)).toBeNull()
  })

  it('never raises a crash or an oom lowering', () => {
    const old = at(T0 - 3600_000)
    const cur: AutoLimits = {
      workers: { cap: 2, cause: 'crash', at: old, detail: '' },
      heavy: { cap: 1, cause: 'oom', at: old, detail: '' },
      checksAsHeavy: { cause: 'oom', at: old },
      history: [{ at: old, what: 'workers', from: 25, to: 2, cause: 'crash', detail: '' }]
    }
    expect(judge(calmFor3Min(T0), cur, live, { workers: 2, heavy: 1 }, person, T0)).toBeNull()
    const mixed: AutoLimits = { ...cur, heavy: { cap: 1, cause: 'strain', at: old, detail: '' } }
    const next = judge(calmFor3Min(T0), mixed, live, { workers: 2, heavy: 1 }, person, T0)!(mixed)
    expect(next.workers).toEqual(cur.workers)
    expect(next.checksAsHeavy).toEqual(cur.checksAsHeavy)
    expect(next.heavy?.cap).toBe(2)
  })
})

describe('readings', () => {
  it('turns load into load per CPU, and a Windows loadavg of 0 never counts as strain', () => {
    expect(sampleOf({ memAvailablePct: 50, load1: 8, cpus: 4, loopDelayP99Ns: 25e6 }, T0)).toEqual({
      at: T0,
      memAvailablePct: 50,
      commitHeadroomPct: null,
      commitReachablePct: null,
      load1PerCpu: 2,
      loopDelayP99Ms: 25
    })
    const win = sampleOf({ memAvailablePct: 50, load1: 0, cpus: 8, loopDelayP99Ns: 0 }, T0)
    expect(win.load1PerCpu).toBe(0)
    expect(judge(run(T0, [win, win, win]), none, live, person, person, T0)).toBeNull()
  })

  it('reads a non-finite memory reading as unknown, which is not strain', () => {
    const s = sampleOf({ memAvailablePct: NaN, load1: 1, cpus: 0, loopDelayP99Ns: NaN }, T0)
    expect(s).toMatchObject({ memAvailablePct: null, load1PerCpu: 0, loopDelayP99Ms: 0 })
    expect(sampleOf({ memAvailablePct: undefined as unknown as number, load1: 0, cpus: 4, loopDelayP99Ns: 0 }, T0).memAvailablePct).toBeNull()
    expect(isStrained(s)).toBe(false)
    expect(isCritical(s)).toBe(false)
    expect(judge(run(T0, [s, s, s]), none, live, person, person, T0)).toBeNull()
  })

  it('on Windows, 4% reachable commit headroom is critical while physical memory is 40% free', () => {
    const s = sampleOf({ memAvailablePct: 40, commitHeadroomPct: 3, commitReachablePct: 4, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect(isCritical(s)).toBe(true)
    const u = judge([{ ...s, at: T0 - SAMPLE_MS }, s], none, live, person, person, T0)!
    expect(u.stage).toBe('pause')
    expect(u(none).workers?.detail).toBe('commit headroom 4% of the reachable limit (3% of the current one) while 10 agents ran')
    const tight = sampleOf({ memAvailablePct: 40, commitHeadroomPct: 8, commitReachablePct: 8, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect([isStrained(tight), isCritical(tight)]).toEqual([true, false])
    const unknown = sampleOf({ memAvailablePct: 40, commitHeadroomPct: NaN, commitReachablePct: NaN, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect([unknown.commitHeadroomPct, unknown.commitReachablePct]).toEqual([null, null])
    expect(isStrained(unknown)).toBe(false)
  })

  it('3% of the current commit limit is not strain while the pagefile can still grow to 40% headroom', () => {
    const s = sampleOf({ memAvailablePct: 40, commitHeadroomPct: 3, commitReachablePct: 40, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect([isStrained(s), isCritical(s)]).toEqual([false, false])
    expect(judge(run(T0, [s, s, s]), none, live, person, person, T0)).toBeNull()
  })

  it('without the reachable reading, low current-limit headroom is strain only when physical memory is low too, and never critical', () => {
    const ample = sampleOf({ memAvailablePct: 40, commitHeadroomPct: 2, commitReachablePct: null, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect([isStrained(ample), isCritical(ample)]).toEqual([false, false])
    expect(judge(run(T0, [ample, ample, ample]), none, live, person, person, T0)).toBeNull()
    const low = sampleOf({ memAvailablePct: 8, commitHeadroomPct: 2, load1: 0, cpus: 24, loopDelayP99Ns: 0 }, T0)
    expect([isStrained(low), isCritical(low)]).toEqual([true, false])
    // 2 samples of it are not enough: no critical from the current limit alone
    expect(judge(run(T0, [CALM, low, low]), none, live, person, person, T0)).toBeNull()
    const u = judge(run(T0, [low, low, low]), none, live, person, person, T0)!
    expect(u(none).workers?.detail).toBe('memory 8% free, commit headroom 2% of the current limit while 10 agents ran')
  })

  it('reads the commit reader line: headroom against the current limit, and against the reachable one after "|"', () => {
    expect(commitReadingOf('1220830 48832304\r')).toEqual({ headroomPct: expect.closeTo(2.5, 3), reachablePct: null })
    expect(commitReadingOf('24416152 48832304')?.headroomPct).toBe(50)
    expect(commitReadingOf(' 0 100 ')?.headroomPct).toBe(0)
    for (const bad of ['', ' ', '#< CLIXML', '5 0', '-1 100', 'abc def', '12', '| 100']) expect(commitReadingOf(bad)).toBeNull()
    // This machine's line: 32 GB RAM, a system-managed 16 GB pagefile on a 1 TB C: with 840 GB free.
    const line = '7513796 49839016 | 32945376 C:,0,16497,840437440512,1012307849216\r'
    const r = commitReadingOf(line)!
    expect(r.headroomPct).toBeCloseTo(15.08, 2)
    const reach = 49839016 + (3 * 32945376 - 16497 * 1024)
    expect(r.reachablePct).toBeCloseTo((100 * (reach - (49839016 - 7513796))) / reach, 6)
    // No pagefile at all: the reachable limit is the current one.
    expect(commitReadingOf('500 1000 | 900')).toEqual({ headroomPct: 50, reachablePct: 50 })
    // A malformed pagefile part leaves only the reachable headroom unknown.
    for (const tail of ['', ' x', ' 900 C:,0,1', ' 900 pagefile', ' 0 C:,0,1,2,3']) {
      expect(commitReadingOf(`500 1000 |${tail}`)).toEqual({ headroomPct: 50, reachablePct: null })
    }
  })

  it('reads MemAvailable, not MemFree, from /proc/meminfo', () => {
    const text = 'MemTotal:       16000000 kB\nMemFree:          400000 kB\nMemAvailable:    8000000 kB\n'
    expect(memAvailablePctOfMeminfo(text)).toBe(50)
    expect(memAvailablePctOfMeminfo('MemTotal: 1 kB\n')).toBeNull()
  })
})

describe('reachableCommitLimitKb', () => {
  const GB_KB = 1024 * 1024
  const MB = 1024
  const ramKb = 32 * GB_KB
  const limitKb = ramKb + 5 * GB_KB // 32 GB RAM + a 5 GB pagefile allocated now
  const disk = 1000 * GB_KB * 1024 // bytes
  const pf = (o: Partial<PagefileReading> = {}): PagefileReading => ({ volume: 'C:', maxMb: 0, allocatedMb: 5 * MB, volumeFreeBytes: disk / 2, volumeSizeBytes: disk, ...o })

  it('grows a system-managed pagefile to 3 x RAM', () => {
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf()] })).toBe(ramKb + 96 * GB_KB)
  })

  it('grows a system-managed pagefile at most to an eighth of its volume, and to 4 GB on a small machine', () => {
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ volumeSizeBytes: 400 * GB_KB * 1024 })] })).toBe(ramKb + 50 * GB_KB)
    const small = 1 * GB_KB
    expect(reachableCommitLimitKb({ limitKb: small + 512 * MB, ramKb: small, pagefiles: [pf({ allocatedMb: 512 })] })).toBe(small + 4 * GB_KB)
  })

  it('grows a fixed pagefile to its maximum, and an unknown one not at all', () => {
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ maxMb: 16 * MB })] })).toBe(ramKb + 16 * GB_KB)
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ maxMb: 5 * MB })] })).toBe(limitKb)
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ maxMb: -1 })] })).toBe(limitKb)
  })

  it('caps the growth by the free disk less the margin, shared on one volume; a full or unknown disk grows nothing', () => {
    const tenFree = 10 * GB_KB * 1024
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ volumeFreeBytes: tenFree })] })).toBe(limitKb + (10 - PAGEFILE_DISK_MARGIN_GB) * GB_KB)
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ volumeFreeBytes: 1 * GB_KB * 1024 })] })).toBe(limitKb)
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ volumeFreeBytes: 0 })] })).toBe(limitKb)
    expect(reachableCommitLimitKb({ limitKb, ramKb, pagefiles: [pf({ volumeFreeBytes: -1 })] })).toBe(limitKb)
    const two = [pf({ maxMb: 20 * MB, volumeFreeBytes: tenFree }), pf({ volume: 'c:', maxMb: 20 * MB, volumeFreeBytes: tenFree })]
    expect(reachableCommitLimitKb({ limitKb: limitKb + 5 * GB_KB, ramKb, pagefiles: two })).toBe(limitKb + 5 * GB_KB + (10 - PAGEFILE_DISK_MARGIN_GB) * GB_KB)
    const elsewhere = [pf({ maxMb: 20 * MB, volumeFreeBytes: tenFree }), pf({ volume: 'D:', maxMb: 20 * MB, volumeFreeBytes: tenFree })]
    expect(reachableCommitLimitKb({ limitKb: limitKb + 5 * GB_KB, ramKb, pagefiles: elsewhere })).toBe(limitKb + 5 * GB_KB + 2 * (10 - PAGEFILE_DISK_MARGIN_GB) * GB_KB)
  })

  it('reads a full disk through the reader line as headroom against the current limit only', () => {
    const line = `1000000 ${limitKb} | ${ramKb} C:,0,${5 * MB},${2 * GB_KB * 1024},${disk}`
    const r = commitReadingOf(line)!
    expect(r.reachablePct).toBeCloseTo(r.headroomPct, 9)
  })
})

describe('the Windows commit reader', () => {
  type FakeChild = EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn>; unref: () => void }
  let now: number
  let children: FakeChild[]
  let calls: Array<Parameters<CommitSpawn>>
  const spawn: CommitSpawn = (...args) => {
    calls.push(args)
    const c = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn(), unref: () => {} })
    children.push(c)
    return c as unknown as ChildProcess
  }
  beforeEach(() => {
    now = T0
    children = []
    calls = []
  })

  it('spawns nothing and reads unknown off Windows', () => {
    const r = createCommitReader({ platform: 'linux', spawn, nowMs: () => now })
    expect(r.latest()).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('starts one hidden PowerShell on win32 and reads the lines it prints', () => {
    const r = createCommitReader({ platform: 'win32', spawn, nowMs: () => now, parentPid: 4242 })
    expect(r.latest()).toBeNull() // nothing read yet: unknown, not 0
    expect(calls).toHaveLength(1)
    const [file, args, opts] = calls[0]
    expect(file).toBe('powershell.exe')
    expect(opts.windowsHide).toBe(true)
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
    for (const name of ['Win32_OperatingSystem', 'Win32_ComputerSystem', 'AutomaticManagedPagefile', 'Win32_PageFileSetting', 'MaximumSize', 'Win32_PageFileUsage', 'AllocatedBaseSize', 'Win32_LogicalDisk']) {
      expect(script).toContain(name)
    }
    expect(script).toContain('Get-Process -Id 4242')
    children[0].stdout.emit('data', Buffer.from('2441615 488'))
    children[0].stdout.emit('data', Buffer.from('32304\r\n'))
    expect(r.latest()).toEqual({ headroomPct: expect.closeTo(5, 5), reachablePct: null })
    children[0].stdout.emit('data', Buffer.from('2441615 48832304 | 32925892 C:,0,15000,500000000000,1000000000000\n'))
    expect(r.latest()?.reachablePct).toBeGreaterThan(50)
    expect(calls).toHaveLength(1) // no process per sample
    now += COMMIT_STALE_MS + 1
    expect(r.latest()).toBeNull()
  })

  it('starts again after it exited, at most every restart interval, and stop kills it', () => {
    const r = createCommitReader({ platform: 'win32', spawn, nowMs: () => now, restartMs: 60_000 })
    r.latest()
    children[0].emit('exit', 1)
    now += 10_000
    r.latest()
    expect(calls).toHaveLength(1)
    now += 60_000
    r.latest()
    expect(calls).toHaveLength(2)
    r.stop()
    expect(children[1].kill).toHaveBeenCalled()
  })

  it('reads unknown when PowerShell cannot be started', () => {
    const r = createCommitReader({
      platform: 'win32',
      spawn: () => {
        throw new Error('ENOENT')
      },
      nowMs: () => now
    })
    expect(r.latest()).toBeNull()
  })
})

describe('changeLines', () => {
  const row = (what: 'workers' | 'heavy' | 'checks', from: number | null, to: number | null, cause: 'strain' | 'calm') => ({ at: '', what, from, to, cause, detail: 'memory 6% free' })

  it('words the pause stage', () => {
    expect(changeLines([row('heavy', 3, 2, 'strain')], { stage: 'pause', floor: 13 })!.feed).toBe(
      'Astera paused new agents and heavy jobs 3 -> 2 while memory 6% free; running agents carry on.'
    )
    const both = changeLines([row('workers', 25, 10, 'strain'), row('heavy', 3, 2, 'strain'), row('checks', null, null, 'strain')], { stage: 'pause' })!
    expect(both.feed).toBe('Astera paused new agents (cap 25 -> 10) and heavy jobs 3 -> 2, checks wait for a heavy slot while memory 6% free; running agents carry on.')
    expect(both.log).toBe('load monitor: paused new agents (cap 25 -> 10), heavy jobs 3 -> 2, checks wait for a heavy slot (memory 6% free)')
  })

  it('words the lowering stage with its floor, and a raise', () => {
    const lower = changeLines([row('workers', 25, 23, 'strain'), row('heavy', 2, 1, 'strain')], { stage: 'lower', floor: 13 })!
    expect(lower.feed).toBe('Astera lowered agents 25 -> 23 (floor 13), heavy jobs 2 -> 1 while memory 6% free; running agents carry on.')
    expect(lower.log).toBe('load monitor: lowered agents 25 -> 23 (floor 13), heavy jobs 2 -> 1 (memory 6% free)')
    expect(changeLines([row('workers', 13, 17, 'calm')], { stage: 'raise' })!.feed).toBe('Machine calm again: agents back to 17')
    expect(changeLines([])).toBeNull()
  })
})

describe('the sampler', () => {
  let dir: string
  let now: number
  let reading: Readings
  let feed: ActivityDraft[]
  let logs: string[]
  let counts: { workers: number; sessions: number; heavyTickets: number; checks: number }
  /** The auto heavy-slot answer reads this much available memory: 25 GB fits 2 heavy jobs. */
  let autoGb: number
  const monitor = () =>
    createLoadMonitor({
      profileDir: dir,
      live: () => counts,
      activity: (d) => feed.push(d),
      log: (m) => logs.push(m),
      readings: () => reading,
      nowMs: () => now,
      platform: 'win32',
      heavyJobs: { platform: 'win32', freemem: () => autoGb * 1024 ** 3, held: () => 0 }
    })
  const settings = (o: Record<string, unknown>): void => writeFileSync(path.join(dir, 'app-settings.json'), JSON.stringify(o))
  const ticks = async (m: { tick(): Promise<void> }, n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await m.tick()
      now += SAMPLE_MS
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'astera-load-monitor-'))
    settings({ maxConcurrentWorkers: 8, heavyJobsAtOnce: 2 })
    now = T0
    reading = { memAvailablePct: 60, load1: 1, cpus: 4, loopDelayP99Ns: 20e6 }
    feed = []
    logs = []
    counts = { workers: 7, sessions: 9, heavyTickets: 1, checks: 2 }
    autoGb = 25
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes the health snapshot on every sample, with the counts and the strained flag', async () => {
    const m = monitor()
    await m.tick()
    expect(JSON.parse(readFileSync(healthFileIn(dir), 'utf8'))).toEqual({
      at: at(T0),
      memAvailablePct: 60,
      load1PerCpu: 0.25,
      loopDelayP99Ms: 20,
      strained: false,
      liveWorkers: 7,
      liveSessions: 9,
      heavyRunning: 1,
      checksRunning: 2
    })
    reading = { ...reading, memAvailablePct: 6 }
    now += SAMPLE_MS
    await m.tick()
    expect(JSON.parse(readFileSync(healthFileIn(dir), 'utf8'))).toMatchObject({ strained: true })
  })

  it('records the commit headroom, and an unknown memory reading as unknown, never 0% free', async () => {
    const m = monitor()
    reading = { ...reading, memAvailablePct: NaN, commitHeadroomPct: 3, commitReachablePct: 4 }
    await m.tick()
    expect(await readHealthSnapshot(dir)).toMatchObject({ memAvailablePct: 100, memUnknown: true, commitHeadroomPct: 3, strained: true })
    expect(JSON.parse(readFileSync(healthFileIn(dir), 'utf8'))).toMatchObject({ commitHeadroomPct: 3, commitReachablePct: 4 })
    now += SAMPLE_MS
    reading = { ...reading, memAvailablePct: 60, commitHeadroomPct: 3, commitReachablePct: 40 }
    await m.tick()
    expect(await readHealthSnapshot(dir)).toMatchObject({ commitHeadroomPct: 3, strained: false })
    reading = { ...reading, memAvailablePct: NaN, commitHeadroomPct: null, commitReachablePct: null }
    now += SAMPLE_MS
    await m.tick()
    const snap = await readHealthSnapshot(dir)
    expect(snap).toMatchObject({ memUnknown: true, strained: false })
    expect(snap).not.toHaveProperty('commitHeadroomPct')
  })

  it('pauses after 3 strained samples, then lowers towards the floor, logs one line each, and touches no session', async () => {
    reading = { ...reading, memAvailablePct: 6 }
    const m = monitor()
    await ticks(m, 3)
    const limits = await readAutoLimits(dir)
    expect(limits.workers).toMatchObject({ cap: 7, cause: 'strain' })
    expect(limits.heavy).toMatchObject({ cap: 1, cause: 'strain' })
    expect(limits.checksAsHeavy).toBeDefined()
    expect(logs).toHaveLength(1)
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ type: 'host.recovered', payload: { title: 'Astera' } })
    expect(feed[0].payload.reason).toContain('paused new agents (cap 8 -> 7)')
    // `live` is a read-only count: the monitor has no handle on a session, and the count it was given is unchanged.
    expect(counts.workers).toBe(7)
    // more strained samples inside the cooldown change nothing
    await ticks(m, 1)
    expect(feed).toHaveLength(1)
    now += LOWER_COOLDOWN_MS
    await ticks(m, 1)
    expect((await readAutoLimits(dir)).workers?.cap).toBe(5) // 7 - 2, the default floor for 8 is 4
    expect(logs[1]).toContain('load monitor: lowered agents 7 -> 5 (floor 4)')
  })

  for (const heavyJobsAtOnce of [undefined, 'auto']) {
    it(`with heavyJobsAtOnce ${heavyJobsAtOnce ?? 'unset'} and auto giving 2, the first strain stage lowers heavy 2 -> 1, and calm raises it back to 2`, async () => {
      settings({ maxConcurrentWorkers: 8, ...(heavyJobsAtOnce ? { heavyJobsAtOnce } : {}) })
      reading = { ...reading, memAvailablePct: 6 }
      const m = monitor()
      await ticks(m, 3)
      expect((await readAutoLimits(dir)).heavy).toMatchObject({ cap: 1, cause: 'strain' })
      expect(logs[0]).toContain('heavy jobs 2 -> 1')
      reading = { ...reading, memAvailablePct: 60 }
      now += CALM_RAISE_MS
      await ticks(m, CALM_RAISE_MS / SAMPLE_MS + 1)
      expect((await readAutoLimits(dir)).heavy).toBeUndefined()
      expect(logs.at(-1)).toContain('heavy jobs back to 2')
    })
  }

  it('takes the floor from minWorkersUnderPressure in the settings file', async () => {
    settings({ maxConcurrentWorkers: 8, heavyJobsAtOnce: 2, minWorkersUnderPressure: 6 })
    reading = { ...reading, memAvailablePct: 6 }
    const m = monitor()
    await ticks(m, 3)
    for (let i = 0; i < 3; i++) {
      now += LOWER_COOLDOWN_MS
      await ticks(m, 1)
    }
    expect((await readAutoLimits(dir)).workers?.cap).toBe(6)
    expect(logs).toEqual([expect.stringContaining('paused new agents (cap 8 -> 7)'), expect.stringContaining('agents 7 -> 6 (floor 6)')])
  })

  it('raises its own lowering after 3 calm minutes and leaves a crash lowering alone', async () => {
    await updateAutoLimits(dir, () => ({
      workers: { cap: 2, cause: 'strain', at: at(T0 - 3600_000), detail: 'd' },
      heavy: { cap: 1, cause: 'crash', at: at(T0 - 3600_000), detail: 'd' },
      history: []
    }))
    const m = monitor()
    await ticks(m, CALM_RAISE_MS / SAMPLE_MS)
    expect((await readAutoLimits(dir)).workers?.cap).toBe(2) // under 3 minutes watched
    await ticks(m, 1)
    const limits = await readAutoLimits(dir)
    expect(limits.workers?.cap).toBe(6)
    expect(limits.heavy).toMatchObject({ cap: 1, cause: 'crash' })
    expect(feed.map((f) => f.payload.reason)).toEqual(['Machine calm again: agents back to 6'])
  })

  it('writes the snapshot and judges nothing when the settings file cannot be read', async () => {
    writeFileSync(path.join(dir, 'app-settings.json'), '{broken')
    reading = { ...reading, memAvailablePct: 2 }
    const m = monitor()
    await ticks(m, 3)
    expect(JSON.parse(readFileSync(healthFileIn(dir), 'utf8')).strained).toBe(true)
    expect((await readAutoLimits(dir)).workers).toBeUndefined()
  })
})
