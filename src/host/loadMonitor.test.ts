import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActivityDraft } from '../core/orchestration/activity'
import { healthFileIn, readAutoLimits, updateAutoLimits, type AutoLimits } from '../core/settings/autoLimits'
import {
  CALM_MS,
  SAMPLE_MS,
  changeLines,
  createLoadMonitor,
  judge,
  memAvailablePctOfMeminfo,
  sampleOf,
  type Caps,
  type LiveCounts,
  type Readings,
  type Sample
} from './loadMonitor'

const T0 = Date.parse('2026-10-26T12:00:00Z')
const CALM: Omit<Sample, 'at'> = { memAvailablePct: 60, load1PerCpu: 0.5, loopDelayP99Ms: 30 }
const STRAINED: Omit<Sample, 'at'> = { memAvailablePct: 6, load1PerCpu: 3.5, loopDelayP99Ms: 1400 }
const CRITICAL: Omit<Sample, 'at'> = { memAvailablePct: 3, load1PerCpu: 0.5, loopDelayP99Ms: 30 }

/** `kinds` oldest first, the last one at `now`, 10 s apart. */
const run = (now: number, kinds: Array<Omit<Sample, 'at'>>): Sample[] => kinds.map((k, i) => ({ ...k, at: now - (kinds.length - 1 - i) * SAMPLE_MS }))
const calmFor20Min = (now: number): Sample[] => run(now, Array(121).fill(CALM))

const live: LiveCounts = { workers: 7, heavyRunning: 1, checksRunning: 0 }
const effective: Caps = { workers: 8, heavy: 2 }
const person: Caps = { workers: 8, heavy: 2 }
const none: AutoLimits = { history: [] }
const at = (ms: number): string => new Date(ms).toISOString()

describe('judge: lowering', () => {
  it('lowers workers to one below the agents running, heavy by one, and turns checks-as-heavy on after 3 strained samples', () => {
    const update = judge(run(T0, [STRAINED, STRAINED, STRAINED]), none, live, effective, person, T0)!
    const next = update(none)
    expect(next.workers).toMatchObject({ cap: 6, cause: 'strain' })
    expect(next.workers!.detail).toBe('memory 6% free, Host loop 1.4 s behind, load 3.5 per CPU while 7 agents ran')
    expect(next.heavy).toMatchObject({ cap: 1, cause: 'strain' })
    expect(next.checksAsHeavy).toMatchObject({ cause: 'strain' })
    expect(next.history.map((h) => [h.what, h.from, h.to, h.cause])).toEqual([
      ['workers', 8, 6, 'strain'],
      ['heavy', 2, 1, 'strain'],
      ['checks', null, null, 'strain']
    ])
  })

  it('lowers after 2 critical samples', () => {
    expect(judge(run(T0, [CALM, CRITICAL, CRITICAL]), none, live, effective, person, T0)).not.toBeNull()
  })

  it('does nothing after 2 strained samples that are not critical, or when the strain is not in a row', () => {
    expect(judge(run(T0, [CALM, STRAINED, STRAINED]), none, live, effective, person, T0)).toBeNull()
    expect(judge(run(T0, [STRAINED, CALM, STRAINED, STRAINED]), none, live, effective, person, T0)).toBeNull()
  })

  it('does nothing within 2 minutes of the last lowering, and lowers again after it', () => {
    const samples = run(T0, [STRAINED, STRAINED, STRAINED])
    const lowered = (ago: number): AutoLimits => ({ history: [{ at: at(T0 - ago), what: 'workers', from: 8, to: 7, cause: 'strain', detail: '' }] })
    expect(judge(samples, lowered(60_000), live, effective, person, T0)).toBeNull()
    expect(judge(samples, lowered(121_000), live, effective, person, T0)).not.toBeNull()
  })

  it('leaves the workers cap alone when no agent runs, or when the cap is already below the agents running', () => {
    const samples = run(T0, [STRAINED, STRAINED, STRAINED])
    const idle = judge(samples, none, { ...live, workers: 0 }, effective, person, T0)!(none)
    expect(idle.workers).toBeUndefined()
    expect(idle.heavy?.cap).toBe(1)
    const already = judge(samples, none, { ...live, workers: 8 }, { workers: 3, heavy: 1 }, person, T0)!(none)
    expect(already.workers?.cap).toBe(2)
    const settled = judge(samples, { history: [], checksAsHeavy: { cause: 'strain', at: at(T0) } }, { ...live, workers: 0 }, { workers: 3, heavy: 1 }, person, T0)
    expect(settled).toBeNull()
  })

  it('never goes below 1', () => {
    const next = judge(run(T0, [STRAINED, STRAINED, STRAINED]), none, { ...live, workers: 1 }, { workers: 2, heavy: 1 }, person, T0)!(none)
    expect(next.workers?.cap).toBe(1)
  })

  it("keeps the cause of a cap a crash set, so it stays the person's to restore", () => {
    const crash: AutoLimits = { history: [], workers: { cap: 5, cause: 'crash', at: at(T0 - 3600_000), detail: 'x' } }
    const next = judge(run(T0, [STRAINED, STRAINED, STRAINED]), crash, live, { workers: 5, heavy: 2 }, person, T0)!(crash)
    expect(next.workers).toMatchObject({ cap: 4, cause: 'crash' })
  })
})

describe('judge: raising', () => {
  const lowered = (over: Partial<AutoLimits> = {}, ago = CALM_MS + 60_000): AutoLimits => ({
    workers: { cap: 5, cause: 'strain', at: at(T0 - ago), detail: 'd' },
    heavy: { cap: 1, cause: 'strain', at: at(T0 - ago), detail: 'd' },
    checksAsHeavy: { cause: 'strain', at: at(T0 - ago) },
    history: [{ at: at(T0 - ago), what: 'workers', from: 8, to: 5, cause: 'strain', detail: 'd' }],
    ...over
  })

  it('raises workers and heavy by 1 and clears checks-as-heavy after 20 calm minutes', () => {
    const cur = lowered()
    const next = judge(calmFor20Min(T0), cur, live, { workers: 5, heavy: 1 }, person, T0)!(cur)
    expect(next.workers?.cap).toBe(6)
    expect(next.heavy).toBeUndefined() // 1 + 1 reaches the person's 2
    expect(next.checksAsHeavy).toBeUndefined()
    expect(next.history.slice(-3).every((h) => h.cause === 'calm')).toBe(true)
  })

  it("removes an entry that reaches the person's own value", () => {
    const cur = lowered({ workers: { cap: 7, cause: 'strain', at: at(T0 - CALM_MS - 1000), detail: 'd' } })
    const next = judge(calmFor20Min(T0), cur, live, { workers: 7, heavy: 1 }, person, T0)!(cur)
    expect(next.workers).toBeUndefined()
    expect(next.heavy).toBeUndefined()
    expect(next.history.find((h) => h.what === 'workers' && h.cause === 'calm')).toMatchObject({ from: 7, to: 8 })
  })

  it('does nothing before 20 calm minutes, after a strained sample inside them, or within 20 minutes of the last change', () => {
    const cur = lowered()
    const eff = { workers: 5, heavy: 1 }
    expect(judge(run(T0, Array(60).fill(CALM)), cur, live, eff, person, T0)).toBeNull()
    const blip = calmFor20Min(T0)
    blip[5] = { ...blip[5], ...STRAINED }
    expect(judge(blip, cur, live, eff, person, T0)).toBeNull()
    expect(judge(calmFor20Min(T0), lowered({}, 15 * 60_000), live, eff, person, T0)).toBeNull()
  })

  it('never raises a crash or an oom lowering', () => {
    const old = at(T0 - 3 * CALM_MS)
    const cur: AutoLimits = {
      workers: { cap: 2, cause: 'crash', at: old, detail: '' },
      heavy: { cap: 1, cause: 'oom', at: old, detail: '' },
      history: [{ at: old, what: 'workers', from: 8, to: 2, cause: 'crash', detail: '' }]
    }
    expect(judge(calmFor20Min(T0), cur, live, { workers: 2, heavy: 1 }, person, T0)).toBeNull()
    const mixed: AutoLimits = { ...cur, heavy: { cap: 1, cause: 'strain', at: old, detail: '' } }
    const next = judge(calmFor20Min(T0), mixed, live, { workers: 2, heavy: 1 }, person, T0)!(mixed)
    expect(next.workers).toMatchObject({ cap: 2, cause: 'crash' })
    expect(next.heavy).toBeUndefined()
  })
})

describe('readings', () => {
  it('turns load into load per CPU, and a Windows loadavg of 0 never counts as strain', () => {
    expect(sampleOf({ memAvailablePct: 50, load1: 8, cpus: 4, loopDelayP99Ns: 25e6 }, T0)).toEqual({ at: T0, memAvailablePct: 50, load1PerCpu: 2, loopDelayP99Ms: 25 })
    const win = sampleOf({ memAvailablePct: 50, load1: 0, cpus: 8, loopDelayP99Ns: 0 }, T0)
    expect(win.load1PerCpu).toBe(0)
    expect(judge(run(T0, [win, win, win]), none, live, effective, person, T0)).toBeNull()
  })

  it('reads NaN and a missing CPU count as 0', () => {
    expect(sampleOf({ memAvailablePct: NaN, load1: 1, cpus: 0, loopDelayP99Ns: NaN }, T0)).toMatchObject({ memAvailablePct: 0, load1PerCpu: 0, loopDelayP99Ms: 0 })
  })

  it('reads MemAvailable, not MemFree, from /proc/meminfo', () => {
    const text = 'MemTotal:       16000000 kB\nMemFree:          400000 kB\nMemAvailable:    8000000 kB\n'
    expect(memAvailablePctOfMeminfo(text)).toBe(50)
    expect(memAvailablePctOfMeminfo('MemTotal: 1 kB\n')).toBeNull()
  })
})

describe('changeLines', () => {
  it('words a lowering and a raise', () => {
    const row = (what: 'workers' | 'heavy' | 'checks', from: number | null, to: number | null, cause: 'strain' | 'calm') => ({ at: '', what, from, to, cause, detail: 'memory 6% free' })
    expect(changeLines([row('workers', 8, 6, 'strain'), row('checks', null, null, 'strain')])!.feed).toBe(
      'Astera holds back new agents: agents 8 -> 6, checks wait for a heavy slot while memory 6% free. Running agents carry on.'
    )
    expect(changeLines([row('workers', 6, 7, 'calm')])!.feed).toBe('Machine calm again: agents back to 7')
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
  const monitor = () =>
    createLoadMonitor({ profileDir: dir, live: () => counts, activity: (d) => feed.push(d), log: (m) => logs.push(m), readings: () => reading, nowMs: () => now })

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'astera-load-monitor-'))
    writeFileSync(path.join(dir, 'app-settings.json'), JSON.stringify({ maxConcurrentWorkers: 8, heavyJobsAtOnce: 2 }))
    now = T0
    reading = { memAvailablePct: 60, load1: 1, cpus: 4, loopDelayP99Ns: 20e6 }
    feed = []
    logs = []
    counts = { workers: 7, sessions: 9, heavyTickets: 1, checks: 2 }
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

  it('lowers the auto-limits after 3 strained samples, logs and posts one feed line, and touches no session', async () => {
    reading = { ...reading, memAvailablePct: 6 }
    const m = monitor()
    for (let i = 0; i < 3; i++) {
      await m.tick()
      now += SAMPLE_MS
    }
    const limits = await readAutoLimits(dir)
    expect(limits.workers).toMatchObject({ cap: 6, cause: 'strain' })
    expect(limits.heavy).toMatchObject({ cap: 1, cause: 'strain' })
    expect(limits.checksAsHeavy).toBeDefined()
    expect(logs).toHaveLength(1)
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ type: 'host.recovered', payload: { title: 'Astera' } })
    expect(feed[0].payload.reason).toContain('agents 8 -> 6')
    // `live` is a read-only count: the monitor has no handle on a session, and the count it was given is unchanged.
    expect(counts.workers).toBe(7)
    // more strained samples inside the cooldown change nothing
    await m.tick()
    expect(feed).toHaveLength(1)
  })

  it('raises its own lowering after 20 calm minutes and leaves a crash lowering alone', async () => {
    await updateAutoLimits(dir, () => ({
      workers: { cap: 5, cause: 'strain', at: at(T0 - 3600_000), detail: 'd' },
      heavy: { cap: 1, cause: 'crash', at: at(T0 - 3600_000), detail: 'd' },
      history: []
    }))
    const m = monitor()
    for (let i = 0; i < 121; i++) {
      await m.tick()
      now += SAMPLE_MS
    }
    const limits = await readAutoLimits(dir)
    expect(limits.workers?.cap).toBe(6)
    expect(limits.heavy).toMatchObject({ cap: 1, cause: 'crash' })
    expect(feed.map((f) => f.payload.reason)).toEqual(['Machine calm again: agents back to 6'])
  })

  it('writes the snapshot and judges nothing when the settings file cannot be read', async () => {
    writeFileSync(path.join(dir, 'app-settings.json'), '{broken')
    reading = { ...reading, memAvailablePct: 2 }
    const m = monitor()
    for (let i = 0; i < 3; i++) {
      await m.tick()
      now += SAMPLE_MS
    }
    expect(JSON.parse(readFileSync(healthFileIn(dir), 'utf8')).strained).toBe(true)
    expect((await readAutoLimits(dir)).workers).toBeUndefined()
  })
})
