import { describe, it, expect } from 'vitest'
import { emptyState, type OrchState } from './state'
import { baseOf, rebase, stampCommitted } from './staleWrite'
import type { Dispatch, Task } from './types'

const d = (id: string, extra: Partial<Dispatch> = {}): Dispatch => ({ id, taskId: 't', provider: 'claude', accountId: 'a', sessionId: 's', cwd: 'c', specPath: '', startedAt: 'x', ...extra }) as Dispatch
const t = (id: string, status: Task['status']): Task => ({ id, status }) as Task

describe('staleWrite', () => {
  it('a committed state is the base of every state spread from it, and JSON does not carry the mark', () => {
    const s = stampCommitted({ ...emptyState() })
    const derived: OrchState = { ...s, dispatches: [d('x')] }
    expect(baseOf(derived)).toBe(s)
    expect(baseOf({ ...derived, tasks: [] })).toBe(s)
    expect(baseOf(JSON.parse(JSON.stringify(derived)) as OrchState)).toBeUndefined()
  })

  it('applies only what the writer changed, and keeps what others committed since its base', () => {
    const keep = d('keep')
    const base: OrchState = { ...emptyState(), dispatches: [keep], tasks: [t('t1', 'ready'), t('t2', 'ready')] }
    const current: OrchState = { ...base, dispatches: [keep, d('theirs')], tasks: [base.tasks[0], t('t2', 'reviewing')] }
    const given: OrchState = { ...base, dispatches: [keep, d('mine')], tasks: [t('t1', 'dispatched'), base.tasks[1]] }
    const r = rebase(base, given, current)
    expect(r.state.dispatches.map((x) => x.id)).toEqual(['keep', 'theirs', 'mine'])
    expect(r.state.tasks.map((x) => x.status)).toEqual(['dispatched', 'reviewing'])
    expect([...r.kept].sort()).toEqual(['dispatches/theirs', 'tasks/t2'])
    expect(r.conflicts).toEqual([])
  })

  it('honours the writer’s delete and another commit’s delete; a change both made takes the writer’s side', () => {
    const a = d('a')
    const b = d('b')
    const c = d('c')
    const base: OrchState = { ...emptyState(), dispatches: [a, b, c] }
    // Another commit deleted b and changed c; the writer deleted a and changed c too.
    const current: OrchState = { ...base, dispatches: [a, d('c', { endedAt: 'y' })] }
    const mineC = d('c', { sessionId: 'real' })
    const given: OrchState = { ...base, dispatches: [b, mineC] }
    const r = rebase(base, given, current)
    expect(r.state.dispatches).toEqual([mineC])
    expect(r.conflicts).toEqual(['dispatches/c'])
  })

  it('a collection only one side touched is that side’s, untouched', () => {
    const base: OrchState = { ...emptyState(), messages: [] }
    const theirs: OrchState = { ...base, gates: [{ id: 'g' } as OrchState['gates'][number]] }
    const given: OrchState = { ...base, projects: [{ id: 'p' } as OrchState['projects'][number]] }
    const r = rebase(base, given, theirs)
    expect(r.state.gates).toBe(theirs.gates)
    expect(r.state.projects).toBe(given.projects)
  })
})
