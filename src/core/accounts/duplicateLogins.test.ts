import { describe, it, expect } from 'vitest'
import type { Account, Provider } from '../types'
import type { Dispatch, Job, Task } from '../orchestration/types'
import { emptyState, type OrchState } from '../orchestration/state'
import { duplicateLoginGroups, sameLogin, rewriteAccountRefs } from './duplicateLogins'

function account(id: string, createdAt: string, provider?: Provider): Account {
  return { id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt, ...(provider ? { provider } : {}) }
}
const emails = (m: Record<string, string | null>) => (id: string) => m[id]

describe('duplicateLoginGroups', () => {
  it('groups accounts of one provider that share an email, ignoring case and spaces', () => {
    const accounts = [
      account('a', '2026-01-01T00:00:00.000Z'),
      account('b', '2026-02-01T00:00:00.000Z'),
      account('c', '2026-03-01T00:00:00.000Z')
    ]
    const groups = duplicateLoginGroups(
      accounts,
      emails({ a: 'Jip.Claude3@gmail.com', b: ' jip.claude3@gmail.com ', c: 'other@gmail.com' }),
      new Set(['a', 'b', 'c'])
    )
    expect(groups).toEqual([{ keepId: 'a', dropIds: ['b'] }])
  })

  it('does not group the same email across providers', () => {
    const accounts = [account('a', '2026-01-01T00:00:00.000Z'), account('x', '2026-01-02T00:00:00.000Z', 'codex')]
    expect(duplicateLoginGroups(accounts, emails({ a: 'me@x.com', x: 'me@x.com' }), new Set(['a', 'x']))).toEqual([])
  })

  it('skips accounts with no email read yet', () => {
    const accounts = [account('a', '2026-01-01T00:00:00.000Z'), account('b', '2026-02-01T00:00:00.000Z')]
    expect(duplicateLoginGroups(accounts, emails({ a: null }), new Set(['a', 'b']))).toEqual([])
  })

  it('keeps the logged-in account even when the other registered first', () => {
    const accounts = [account('old', '2026-01-01T00:00:00.000Z'), account('new', '2026-05-01T00:00:00.000Z')]
    const groups = duplicateLoginGroups(accounts, emails({ old: 'm@x.com', new: 'm@x.com' }), new Set(['new']))
    expect(groups).toEqual([{ keepId: 'new', dropIds: ['old'] }])
  })

  it('on a tie keeps the earliest registered, and lists every other one to drop', () => {
    const accounts = [
      account('b', '2026-02-01T00:00:00.000Z'),
      account('a', '2026-01-01T00:00:00.000Z'),
      account('c', '2026-03-01T00:00:00.000Z')
    ]
    const e = emails({ a: 'm@x.com', b: 'm@x.com', c: 'm@x.com' })
    expect(duplicateLoginGroups(accounts, e, new Set(['a', 'b', 'c']))).toEqual([{ keepId: 'a', dropIds: ['b', 'c'] }])
    expect(duplicateLoginGroups(accounts, e, new Set())).toEqual([{ keepId: 'a', dropIds: ['b', 'c'] }])
  })
})

describe('sameLogin', () => {
  it('needs the same provider and the same non-empty email', () => {
    const a = account('a', '2026-01-01T00:00:00.000Z')
    expect(sameLogin(a, 'M@x.com', account('b', '2026-01-01T00:00:00.000Z'), ' m@x.com')).toBe(true)
    expect(sameLogin(a, 'm@x.com', account('b', '2026-01-01T00:00:00.000Z', 'codex'), 'm@x.com')).toBe(false)
    expect(sameLogin(a, null, account('b', '2026-01-01T00:00:00.000Z'), null)).toBe(false)
  })
})

describe('rewriteAccountRefs', () => {
  const task = (id: string, accountIds?: string[]): Task => ({ id, ...(accountIds ? { accountIds } : {}) }) as Task
  const job = (id: string, f: Partial<Job>): Job => ({ id, ...f }) as Job
  const dispatch = (id: string, accountId: string): Dispatch => ({ id, accountId }) as Dispatch
  const stateOf = (p: Partial<OrchState>): OrchState => ({ ...emptyState(), ...p })

  it('moves Task chains, Job accounts and Dispatch accounts to the kept account', () => {
    const before = stateOf({
      tasks: [task('t1', ['drop', 'x']), task('t2', ['x']), task('t3')],
      jobs: [job('j1', { coordinatorAccountId: 'drop', plannerAccountId: 'drop', preferredAccountId: 'drop' }), job('j2', { plannerAccountId: 'x' })],
      dispatches: [dispatch('d1', 'drop'), dispatch('d2', 'x')]
    })
    const { state, changed } = rewriteAccountRefs(before, 'keep', 'drop')
    expect(state.tasks.map((t) => t.accountIds)).toEqual([['keep', 'x'], ['x'], undefined])
    expect(state.jobs[0]).toMatchObject({ coordinatorAccountId: 'keep', plannerAccountId: 'keep', preferredAccountId: 'keep' })
    expect(state.jobs[1]).toMatchObject({ plannerAccountId: 'x' })
    expect(state.dispatches.map((d) => d.accountId)).toEqual(['keep', 'x'])
    expect(changed).toBe(3)
  })

  it('collapses a chain that already holds both accounts, in order', () => {
    const before = stateOf({ tasks: [task('t', ['drop', 'x', 'keep']), task('u', ['keep', 'drop'])] })
    const { state } = rewriteAccountRefs(before, 'keep', 'drop')
    expect(state.tasks.map((t) => t.accountIds)).toEqual([['keep', 'x'], ['keep']])
  })

  it('returns the same state when nothing refers to the dropped account', () => {
    const before = stateOf({ tasks: [task('t', ['x'])] })
    const r = rewriteAccountRefs(before, 'keep', 'drop')
    expect(r.state).toBe(before)
    expect(r.changed).toBe(0)
  })
})
