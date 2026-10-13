import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PluginsCallAnswer } from '../../../core/types'
import { createPluginsPoller, installBlocked, keepOnly } from './pluginsList'

// 2d final review I1: the Host's plugin calls run one at a time, so a list read sent during a long change waits behind
// it and passes the app's 15 s deadline; the tab does not poll while a change of its own is in flight.
describe('createPluginsPoller', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  const rig = (answer: () => Promise<PluginsCallAnswer> = async () => ({ ok: true, body: { plugins: [{ id: 'a' }] } })) => {
    let busy = false
    let reads = 0
    const lists: unknown[][] = []
    const failures: string[] = []
    const poller = createPluginsPoller({
      read: () => {
        reads++
        return answer()
      },
      onList: (l) => lists.push(l),
      onFailure: (r) => failures.push(r.code),
      busy: () => busy,
      everyMs: 3_000
    })
    return { poller, lists, failures, reads: () => reads, setBusy: (b: boolean) => void (busy = b) }
  }

  it('reads at once and every interval, skips a tick while a change is in flight, and stops when told', async () => {
    const r = rig()
    const stop = r.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(r.reads()).toBe(1)
    expect(r.lists).toEqual([[{ id: 'a' }]])
    r.setBusy(true)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(r.reads()).toBe(1)
    r.setBusy(false)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(r.reads()).toBe(2)
    stop()
    await vi.advanceTimersByTimeAsync(9_000)
    expect(r.reads()).toBe(2)
  })

  it('reads when asked even while busy, and once more after a read in flight rather than beside it', async () => {
    let release: () => void = () => {}
    let n = 0
    const r = rig(() => {
      n++
      return n === 1 ? new Promise((res) => (release = () => res({ ok: true, body: { plugins: [] } }))) : Promise.resolve({ ok: true, body: { plugins: [{ id: 'b' }] } })
    })
    r.setBusy(true)
    const first = r.poller.now()
    const second = r.poller.now()
    expect(r.reads()).toBe(1)
    release()
    await first
    await second
    expect(r.reads()).toBe(2)
    expect(r.lists).toEqual([[], [{ id: 'b' }]])
  })

  it('hands a failed read on and keeps reading', async () => {
    let ok = false
    const r = rig(async () => (ok ? { ok: true, body: { plugins: [] } } : { ok: false, code: 'HOST_NOT_RUNNING', message: 'x' }))
    const stop = r.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(r.failures).toEqual(['HOST_NOT_RUNNING'])
    ok = true
    await vi.advanceTimersByTimeAsync(3_000)
    expect(r.lists).toEqual([[]])
    stop()
  })
})

// 2d final review M3: what the tab keeps about a plugin goes when the plugin does.
describe('keepOnly', () => {
  it('drops what belongs to ids no longer listed, and keeps the same object when nothing goes', () => {
    const o = { a: 1, b: 2 }
    expect(keepOnly(o, new Set(['a', 'b']))).toBe(o)
    expect(keepOnly(o, new Set(['a']))).toEqual({ a: 1 })
  })
})

// 2d final review M5: with no Host to ask, or one that runs no plugins, there is nothing to install into.
describe('installBlocked', () => {
  it('blocks an install when the list said no Host or no plugins, and not for a slow answer', () => {
    expect(installBlocked('HOST_NOT_RUNNING')).toBe(true)
    expect(installBlocked('NOT_SUPPORTED')).toBe(true)
    expect(installBlocked('TIMEOUT')).toBe(false)
    expect(installBlocked(null)).toBe(false)
  })
})
