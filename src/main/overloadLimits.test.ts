import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAutoLimits } from '../core/settings/autoLimits'
import { FREEZE_MIN_MS, freezeLowering, oomLowering, UnresponsiveCounter, watchWindowFreezes } from './overloadLimits'

const NOW = '2026-10-26T10:00:00.000Z'
const empty = { history: [] }

describe('oomLowering', () => {
  it('caps one below the live workers, turns checks-as-heavy on, cause oom', () => {
    const next = oomLowering({ what: 'renderer', effectiveWorkers: 8, liveWorkers: 6, now: NOW })(empty)
    expect(next.workers).toEqual({ cap: 5, cause: 'oom', at: NOW, detail: 'The window ran out of memory while 6 agents ran' })
    expect(next.checksAsHeavy).toEqual({ cause: 'oom', at: NOW })
    expect(next.history).toHaveLength(1)
  })
  it.each([
    [8, 6, 5],
    [4, 6, 3],
    [8, 0, 1],
    [1, 5, 1]
  ])('effective %i live %i gives cap %i', (effectiveWorkers, liveWorkers, cap) => {
    expect(oomLowering({ what: 'renderer', effectiveWorkers, liveWorkers, now: NOW })(empty).workers?.cap).toBe(cap)
  })
  it('never raises an existing lower cap, and takes a strain cap over as oom', () => {
    const cur = { history: [], workers: { cap: 2, cause: 'strain' as const, at: 'x', detail: '' } }
    const next = oomLowering({ what: 'renderer', effectiveWorkers: 8, liveWorkers: 6, now: NOW })(cur)
    expect(next.workers).toMatchObject({ cap: 2, cause: 'oom' })
  })
  it('keeps an oom cap as it is on a repeat', () => {
    const f = oomLowering({ what: 'renderer', effectiveWorkers: 8, liveWorkers: 6, now: NOW })
    const once = f(empty)
    expect(f(once)).toEqual(once)
  })
})

describe('UnresponsiveCounter', () => {
  const freeze = (c: UnresponsiveCounter, at: number, ms = FREEZE_MIN_MS): boolean => {
    c.unresponsive(at)
    return c.responsive(at + ms)
  }
  it('does nothing for one freeze', () => {
    expect(freeze(new UnresponsiveCounter(), 0)).toBe(false)
  })
  it('lowers once on the second 5 s freeze within 10 minutes, not on a third in the cooldown', () => {
    const c = new UnresponsiveCounter()
    expect(freeze(c, 0)).toBe(false)
    expect(freeze(c, 60_000)).toBe(true)
    expect(freeze(c, 120_000)).toBe(false)
  })
  it('ignores freezes under 5 s', () => {
    const c = new UnresponsiveCounter()
    expect(freeze(c, 0, 4_000)).toBe(false)
    expect(freeze(c, 60_000, 4_000)).toBe(false)
  })
  it('does not pair freezes more than 10 minutes apart', () => {
    const c = new UnresponsiveCounter()
    freeze(c, 0)
    expect(freeze(c, 11 * 60_000)).toBe(false)
  })
  it('lowers again after the cooldown', () => {
    const c = new UnresponsiveCounter()
    freeze(c, 0)
    expect(freeze(c, 1_000)).toBe(true)
    expect(freeze(c, 11 * 60_000)).toBe(false)
    expect(freeze(c, 11 * 60_000 + 10_000)).toBe(true)
  })
})

describe('freezeLowering', () => {
  it('goes one below the effective cap with cause strain; floor 1', () => {
    expect(freezeLowering({ effectiveWorkers: 4, freezes: 2, now: NOW })(empty).workers).toEqual({
      cap: 3,
      cause: 'strain',
      at: NOW,
      detail: 'The window froze 2 times in 10 minutes'
    })
    expect(freezeLowering({ effectiveWorkers: 1, freezes: 2, now: NOW })(empty).workers?.cap).toBe(1)
  })
})

describe('watchWindowFreezes', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  it('writes the strain cap after two long freezes', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'overload-'))
    const l: Record<string, () => void> = {}
    let t = Date.parse(NOW)
    watchWindowFreezes({ on: (e, fn) => void (l[e] = fn) }, { profileDir: dir, effectiveWorkers: () => 4, now: () => t })
    for (let i = 0; i < 2; i++) {
      l.unresponsive()
      t += 6_000
      l.responsive()
      t += 6_000
    }
    await new Promise((r) => setTimeout(r, 200))
    expect((await readAutoLimits(dir)).workers).toMatchObject({ cap: 3, cause: 'strain' })
  })
})
