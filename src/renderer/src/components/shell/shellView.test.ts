import { describe, it, expect } from 'vitest'
import type { Account } from '../../../../core/types'
import type { Job, JobRun, Task } from '../../../../core/orchestration/types'
import { activeAccountOf, nextQueuedLine, shellCounts } from './shellView'

describe('shellCounts', () => {
  const sessions = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'running' },
    { id: 'c', status: 'running' },
    { id: 'd', status: 'exited' }
  ]

  it('counts live consoles and the working ones; an ended console counts for neither', () => {
    const c = shellCounts(sessions, { a: 'working', b: 'waiting', d: 'working' }, [])
    expect([c.consoles, c.working]).toEqual([3, 1])
  })

  it('the waiting count is the Inbox’s needs-you list, so the status bar and the Inbox tab never disagree', () => {
    expect(shellCounts(sessions, { b: 'waiting' }, [{ kind: 'session' }, { kind: 'gate' }]).waiting).toBe(2)
    expect(shellCounts([], {}, []).waiting).toBe(0)
  })
})

describe('nextQueuedLine', () => {
  const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: `objective ${id}`, cwd: '/r', createdAt: '2026-10-01T00:00:00Z', ...over })
  const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, createdAt: '2026-10-01T00:00:00Z', ...over })
  const none = { runs: [] as JobRun[], tasks: [] as Task[] }

  it('is null with nothing queued', () => {
    expect(nextQueuedLine({ jobs: [job('a', { title: 'Auth' })], ...none })).toBeNull()
  })

  it('names the oldest queued plan and what it waits for, and counts the rest', () => {
    const jobs = [
      job('api', { title: 'Leaderboard API' }),
      job('r2', { title: 'Redesign 9.2', after: 'api', pendingStart: true, createdAt: '2026-10-03T00:00:00Z' }),
      job('r1', { title: 'Redesign 9.1', after: 'api', pendingStart: true, createdAt: '2026-10-02T00:00:00Z' })
    ]
    expect(nextQueuedLine({ jobs, ...none })).toBe('Next: Redesign 9.1 starts after Leaderboard API delivers (+1)')
  })

  it('a plan already planning is not queued any more', () => {
    const jobs = [job('api'), job('r', { after: 'api', pendingStart: true, plannerSessionIds: ['p'] })]
    expect(nextQueuedLine({ jobs, ...none })).toBeNull()
  })

  it('says so when the plan it waits on stopped', () => {
    const jobs = [job('api', { title: 'API', archivedAt: '2026-10-02T00:00:00Z' }), job('r', { title: 'R', after: 'api', pendingStart: true })]
    expect(nextQueuedLine({ jobs, runs: [run('x', 'api')], tasks: [] })).toBe('Next: R waits on API, which stopped')
  })
})

describe('activeAccountOf', () => {
  const acc = (id: string): Account => ({ id, label: id, configDir: `/c/${id}`, color: 'x', createdAt: '' })
  it('is the focused console’s account, else the first', () => {
    expect(activeAccountOf([acc('a'), acc('b')], 'b')?.id).toBe('b')
    expect(activeAccountOf([acc('a'), acc('b')], undefined)?.id).toBe('a')
    expect(activeAccountOf([acc('a')], 'gone')?.id).toBe('a')
    expect(activeAccountOf([], 'a')).toBeUndefined()
  })
})
