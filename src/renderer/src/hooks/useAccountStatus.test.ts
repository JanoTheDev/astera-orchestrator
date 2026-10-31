// T3 (account center sync): one window-wide login-status store instead of a probe round per mounted hook.
import { describe, it, expect } from 'vitest'
import type { Account } from '../../../core/types'
import { createAccountStatusStore, followAccountsList, loginMapOf, STATUS_POLL_MS, type AccountStatusAnswer } from './useAccountStatus'

/** A store over scripted IO: every status ask is held until the test settles it. */
function harness() {
  const asks: string[] = []
  const pending: Array<{ id: string; ok: (a: AccountStatusAnswer) => void; fail: (e: unknown) => void }> = []
  let changed: ((id: string) => void) | null = null
  let focus: (() => void) | null = null
  let tick: (() => void) | null = null
  let now = 1_000_000
  let usageRefreshes = 0
  const store = createAccountStatusStore({
    status: (id) =>
      new Promise<AccountStatusAnswer>((ok, fail) => {
        asks.push(id)
        pending.push({ id, ok, fail })
      }),
    onChanged: (cb) => ((changed = cb), () => void (changed = null)),
    onFocus: (cb) => ((focus = cb), () => void (focus = null)),
    every: (ms, cb) => {
      expect(ms).toBe(STATUS_POLL_MS)
      tick = cb
      return () => void (tick = null)
    },
    refreshUsage: () => void usageRefreshes++,
    now: () => now
  })
  const settle = async (id: string, a: AccountStatusAnswer | Error): Promise<void> => {
    const i = pending.findIndex((p) => p.id === id)
    const [p] = pending.splice(i, 1)
    if (a instanceof Error) p.fail(a)
    else p.ok(a)
    await Promise.resolve()
    await Promise.resolve()
  }
  return {
    store,
    asks,
    settle,
    pendingCount: () => pending.length,
    push: (id: string) => changed?.(id),
    focus: () => focus?.(),
    tick: () => tick?.(),
    wired: () => ({ changed: changed !== null, focus: focus !== null, tick: tick !== null }),
    advance: (ms: number) => void (now += ms),
    usageRefreshes: () => usageRefreshes
  }
}

const IN = { login: 'signedIn', email: 'a@x' } as const
const OUT = { login: 'signedOut', email: null } as const

describe('createAccountStatusStore', () => {
  it('two mounted hooks over the same accounts share one probe per account', async () => {
    const h = harness()
    const a = h.store.track(['a1', 'a2'])
    const b = h.store.track(['a1', 'a2'])
    expect(h.asks).toEqual(['a1', 'a2'])
    await h.settle('a1', IN)
    await h.settle('a2', OUT)
    expect(h.store.get().states).toEqual({ a1: 'signedIn', a2: 'signedOut' })
    expect(h.store.get().emails).toEqual({ a1: 'a@x', a2: null })
    a()
    b()
  })

  it('re-probes on the status push from main, on window focus, and every STATUS_POLL_MS while mounted', async () => {
    const h = harness()
    const off = h.store.track(['a1'])
    await h.settle('a1', OUT)
    h.push('a1')
    await h.settle('a1', IN)
    expect(h.store.get().states.a1).toBe('signedIn')
    h.focus()
    await h.settle('a1', IN)
    h.tick()
    await h.settle('a1', { login: 'expired', email: 'a@x' })
    expect(h.store.get().states.a1).toBe('expired')
    expect(h.asks).toEqual(['a1', 'a1', 'a1', 'a1'])

    off()
    expect(h.wired()).toEqual({ changed: false, focus: false, tick: false }) // nothing mounted: no timer, no listeners
  })

  it('a push for an account no surface shows is ignored', () => {
    const h = harness()
    h.store.track(['a1'])
    h.push('other')
    expect(h.asks).toEqual(['a1'])
  })

  // Finding 9: a failed probe left loginMap[id] undefined, and the row's Sign in / Sign out items vanished.
  it('a failed probe keeps the last known state, and is unknown (never absent) when there was none', async () => {
    const h = harness()
    h.store.track(['a1', 'a2'])
    await h.settle('a1', IN)
    await h.settle('a2', new Error('ipc failed'))
    expect(h.store.get().states).toEqual({ a1: 'signedIn', a2: 'unknown' })
    h.focus()
    await h.settle('a1', new Error('ipc failed'))
    expect(h.store.get().states.a1).toBe('signedIn')
    expect(h.store.get().emails.a1).toBe('a@x')
  })

  it('an older answer that lands after a newer one is dropped', async () => {
    const h = harness()
    h.store.track(['a1'])
    h.focus() // a second round while the first is still out
    // settle the newer one first, then the older one
    const all = h.pendingCount()
    expect(all).toBe(2)
    await h.settle('a1', OUT) // the first (older) ask
    // the store waits for the newest round: the older answer does not land
    expect(h.store.get().states.a1).toBeUndefined()
    await h.settle('a1', IN)
    expect(h.store.get().states.a1).toBe('signedIn')
  })

  it('a hook mounting again re-probes accounts not asked just now (the popover opening)', async () => {
    const h = harness()
    const first = h.store.track(['a1'])
    await h.settle('a1', IN)
    const again = h.store.track(['a1']) // moments later: nothing asked
    expect(h.asks).toEqual(['a1'])
    again()
    h.advance(5_000)
    h.store.track(['a1'])
    expect(h.asks).toEqual(['a1', 'a1'])
    first()
  })

  it('refresh re-probes every mounted account and asks main for fresher usage', async () => {
    const h = harness()
    h.store.track(['a1', 'a2'])
    await h.settle('a1', IN)
    await h.settle('a2', IN)
    h.store.refresh()
    expect(h.asks).toEqual(['a1', 'a2', 'a1', 'a2'])
    expect(h.usageRefreshes()).toBe(1)
  })

  it('subscribers hear each change, and the snapshot is stable between changes', async () => {
    const h = harness()
    let heard = 0
    const unsub = h.store.subscribe(() => void heard++)
    h.store.track(['a1'])
    const before = h.store.get()
    expect(h.store.get()).toBe(before)
    await h.settle('a1', IN)
    expect(heard).toBe(1)
    expect(h.store.get()).not.toBe(before)
    unsub()
  })
})

describe('loginMapOf', () => {
  it('signed in is true, signed out and expired are false, unknown is left out', () => {
    expect(loginMapOf({ a: 'signedIn', b: 'signedOut', c: 'expired', d: 'unknown' })).toEqual({ a: true, b: false, c: false })
  })
})

// Finding 8: the workbench asked accounts.list() and subscribed to accounts:changed separately, so a slow first
// answer could put the older list back over a newer pushed one.
describe('followAccountsList', () => {
  const acc = (id: string): Account => ({ id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt: '2026-10-31T00:00:00Z' })

  it('subscribes before it asks, and a first answer that lands after a push is dropped', async () => {
    const order: string[] = []
    let push: (a: Account[]) => void = () => {}
    let answer!: (a: Account[]) => void
    const got: string[][] = []
    followAccountsList({
      on: (cb) => ((order.push('on'), (push = cb)), () => {}),
      ask: () => (order.push('ask'), new Promise<Account[]>((r) => (answer = r))),
      set: (a) => void got.push(a.map((x) => x.id))
    })
    expect(order).toEqual(['on', 'ask'])
    push([acc('a1'), acc('a2')]) // an account was added while the startup read was out
    answer([acc('a1')])
    await Promise.resolve()
    await Promise.resolve()
    expect(got).toEqual([['a1', 'a2']])
  })

  it('with no push first, the answer is used, and later pushes keep landing', async () => {
    let push: (a: Account[]) => void = () => {}
    const got: string[][] = []
    followAccountsList({ on: (cb) => ((push = cb), () => {}), ask: async () => [acc('a1')], set: (a) => void got.push(a.map((x) => x.id)) })
    await Promise.resolve()
    await Promise.resolve()
    push([])
    expect(got).toEqual([['a1'], []])
  })
})
