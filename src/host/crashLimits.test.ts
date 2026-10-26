import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autoLimitsFileIn, readAutoLimits, signalExitFileIn, updateAutoLimits, writeHealthSnapshotSync, writeSignalExitSync, type AutoLimits, type HealthSnapshot } from '../core/settings/autoLimits'
import { emptyState, type OrchState } from '../core/orchestration/state'
import { cleanExitFileIn, writeCleanExit } from './sessionRestore'
import { countsAtCrash, crashLowering, lowerLimitsAfterCrash, markExit } from './crashLimits'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-crash-limits-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const NOW = '2026-10-26T12:00:00.000Z'
const health = (o: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  at: '2026-10-26T11:59:30.000Z',
  memAvailablePct: 4,
  load1PerCpu: 3,
  loopDelayP99Ms: 900,
  strained: false,
  liveWorkers: 8,
  liveSessions: 10,
  heavyRunning: 2,
  checksRunning: 3,
  ...o
})
const base = { clean: false, signal: null, health: health(), workersAtCrash: 8, heavyAtCrash: 2, checksAtCrash: 3, effectiveWorkers: 8, effectiveHeavy: 2, now: NOW }
const empty = (): AutoLimits => ({ history: [] })

describe('crashLowering', () => {
  it('changes nothing after a clean exit', () => {
    expect(crashLowering({ ...base, clean: true })).toBeNull()
  })
  it('changes nothing after a signal while the machine was not strained (a reboot or a kill)', () => {
    expect(crashLowering({ ...base, signal: 'SIGTERM' })).toBeNull()
    expect(crashLowering({ ...base, signal: 'SIGTERM', health: null })).toBeNull()
  })
  it('lowers after a signal while the machine was strained', () => {
    const next = crashLowering({ ...base, signal: 'SIGTERM', health: health({ strained: true }) })!(empty())
    expect(next.workers?.cap).toBe(6)
  })
  it('changes nothing when nothing was running', () => {
    expect(crashLowering({ ...base, workersAtCrash: 0, heavyAtCrash: 0, checksAtCrash: 0 })).toBeNull()
  })
  it('lowers agents 8 -> 6, heavy 2 -> 1 and makes checks wait for heavy slots after a hard death with 8/2/3', () => {
    const next = crashLowering(base)!(empty())
    expect(next.workers).toMatchObject({ cap: 6, cause: 'crash', at: NOW })
    expect(next.heavy).toMatchObject({ cap: 1, cause: 'crash', at: NOW })
    expect(next.checksAsHeavy).toEqual({ cause: 'crash', at: NOW })
    expect(next.workers?.detail).toBe('Host ended without a clean exit while 8 agents, 2 heavy jobs and 3 checks ran; memory 4% free')
    expect(next.history.map((h) => [h.what, h.from, h.to, h.cause])).toEqual([
      ['workers', 8, 6, 'crash'],
      ['heavy', 2, 1, 'crash'],
      ['checks', null, null, 'crash']
    ])
  })
  it('leaves the agent cap alone when only one worker ran', () => {
    expect(crashLowering({ ...base, workersAtCrash: 1, heavyAtCrash: 0, checksAtCrash: 0, effectiveHeavy: 1 })).toBeNull()
  })
  it('keeps an existing lower auto cap and never raises it', () => {
    const cur: AutoLimits = {
      workers: { cap: 3, cause: 'strain', at: 'earlier', detail: 'lagged' },
      heavy: { cap: 1, cause: 'strain', at: 'earlier', detail: 'lagged' },
      checksAsHeavy: { cause: 'strain', at: 'earlier' },
      history: []
    }
    // The effective caps already include the auto ones, as readMaxConcurrentWorkers / readHeavyJobsAtOnce return them.
    // 8 ran under a cap of 3 (lowered after they started): min(3, 8) - 2
    const next = crashLowering({ ...base, effectiveWorkers: 3, effectiveHeavy: 1 })!(cur)
    expect(next.workers).toMatchObject({ cap: 1, cause: 'crash' })
    const kept = crashLowering({ ...base, workersAtCrash: 2, effectiveWorkers: 8, effectiveHeavy: 1 })!({ ...cur, workers: { cap: 1, cause: 'strain', at: 'earlier', detail: 'lagged' } })
    expect(kept.workers).toMatchObject({ cap: 1, cause: 'strain' })
    expect(kept.heavy).toMatchObject({ cap: 1, cause: 'strain' })
    expect(kept.checksAsHeavy).toEqual({ cause: 'strain', at: 'earlier' })
    expect(kept.history).toEqual([])
  })
})

describe('countsAtCrash', () => {
  const state = (): OrchState => {
    const s = emptyState()
    s.dispatches = [
      { id: 'd1', taskId: 't1' },
      { id: 'd2', taskId: 't2' },
      { id: 'd3', taskId: 't3', endedAt: 'x' }
    ] as unknown as OrchState['dispatches']
    s.tasks = [{ id: 't4', status: 'validating' }] as unknown as OrchState['tasks']
    return s
  }
  it('takes the last health sample when it is younger than two minutes', () => {
    expect(countsAtCrash({ health: health(), state: state(), nowMs: Date.parse(NOW) })).toEqual({ workers: 8, heavy: 2, checks: 3 })
  })
  it('counts from orchestration.json when the sample is old or missing', () => {
    expect(countsAtCrash({ health: health({ at: '2026-10-26T11:50:00.000Z' }), state: state(), nowMs: Date.parse(NOW) })).toEqual({ workers: 2, heavy: 0, checks: 1 })
    expect(countsAtCrash({ health: null, state: null, nowMs: Date.parse(NOW) })).toEqual({ workers: 0, heavy: 0, checks: 0 })
  })
})

describe('markExit', () => {
  it('writes the signal marker on SIGINT/SIGTERM and no clean-exit marker', () => {
    markExit(dir, 'SIGTERM', false)
    expect(readFileSync(signalExitFileIn(dir), 'utf8')).toBe('SIGTERM')
    expect(existsSync(cleanExitFileIn(dir))).toBe(false)
  })
  it('writes the clean-exit marker on a deliberate way out, and nothing on a handover', () => {
    markExit(dir, undefined, true)
    expect(existsSync(cleanExitFileIn(dir))).toBe(false)
    markExit(dir, undefined, false)
    expect(existsSync(cleanExitFileIn(dir))).toBe(true)
    expect(existsSync(signalExitFileIn(dir))).toBe(false)
  })
})

describe('lowerLimitsAfterCrash', () => {
  const run = async (state: OrchState | null = null, eff = { workers: 8, heavy: 2 }) => {
    const lines: string[] = []
    const feed: string[] = []
    const r = await lowerLimitsAfterCrash({
      profileDir: dir,
      state,
      effective: async () => eff,
      log: (m) => lines.push(m),
      activity: (d) => feed.push(d.payload.reason ?? ''),
      now: () => new Date(NOW)
    })
    return { r, lines, feed }
  }

  it('writes workers 6, heavy 1, checks as heavy after a hard death with 8/2/3, logs it and posts a feed line', async () => {
    writeHealthSnapshotSync(dir, health())
    const { lines, feed } = await run()
    const a = await readAutoLimits(dir)
    expect(a.workers?.cap).toBe(6)
    expect(a.heavy?.cap).toBe(1)
    expect(a.checksAsHeavy?.cause).toBe('crash')
    expect(lines).toEqual(['start after a hard exit: lowered agents 8 -> 6, heavy 2 -> 1, checks wait for heavy slots'])
    expect(feed).toEqual(['Astera lowered its limits after a crash: agents 8 -> 6, heavy 2 -> 1, checks wait for heavy slots'])
  })
  it('changes nothing after a SIGTERM with an unstrained sample, and takes the marker', async () => {
    writeHealthSnapshotSync(dir, health())
    writeSignalExitSync(dir, 'SIGTERM')
    const { lines, feed } = await run()
    expect(existsSync(autoLimitsFileIn(dir))).toBe(false)
    expect(existsSync(signalExitFileIn(dir))).toBe(false)
    expect(lines).toEqual(['start after a SIGTERM exit: limits unchanged'])
    expect(feed).toEqual([])
  })
  it('changes nothing after a clean exit and leaves the clean-exit marker for the session restore', async () => {
    writeHealthSnapshotSync(dir, health())
    writeCleanExit(dir)
    const { lines } = await run()
    expect(existsSync(autoLimitsFileIn(dir))).toBe(false)
    expect(existsSync(cleanExitFileIn(dir))).toBe(true)
    expect(lines).toEqual(['start after a clean exit: limits unchanged'])
  })
  it('says unchanged when an existing auto cap is already as low', async () => {
    writeHealthSnapshotSync(dir, health({ liveWorkers: 2, heavyRunning: 0, checksRunning: 0 }))
    await updateAutoLimits(dir, () => ({ workers: { cap: 1, cause: 'strain', at: 'x', detail: '' }, history: [] }))
    // two agents ran under a cap of 8, so the rule asks for 1, which the existing cap already is
    const { lines, feed } = await run(null, { workers: 8, heavy: 1 })
    expect((await readAutoLimits(dir)).workers?.cause).toBe('strain')
    expect(lines).toEqual(['start after a hard exit: limits unchanged'])
    expect(feed).toEqual([])
  })
})
