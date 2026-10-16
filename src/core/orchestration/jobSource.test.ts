// A Job keeps the job source it was made from (Phase 4 J15): the Host sets it through a key no JSON can hold, so a
// caller of jobs-create cannot fake one, and it is on the public Job and on job.created.
import { describe, it, expect } from 'vitest'
import { handleCommand, JOB_SOURCE, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { derivePublicEvents } from './publicEvents'

const NOW = '2026-10-14T00:00:00.000Z'
const ref = { id: 'astera-linear-source', itemId: 'ENG-1', label: 'Linear ENG-1', url: 'https://linear.app/x/ENG-1' }

const makeDeps = (initial: OrchState = emptyState()): OrchServerDeps => {
  const box = { state: initial }
  return {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 's', cwd: 'D:/p', specPath: 'D:/p/s.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'one', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps
}

describe('Job.source (J15)', () => {
  it('is kept when the Host makes the Job with it, in the state and in the answer', async () => {
    const deps = makeDeps()
    const r = await handleCommand(deps, { sessionId: '' }, 'jobs-create', { objective: 'o', cwd: 'D:/p', [JOB_SOURCE]: ref })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ source: ref })
    expect(deps.getState().jobs[0].source).toEqual(ref)
  })

  it('cannot be given by a caller of jobs-create', async () => {
    const deps = makeDeps()
    const r = await handleCommand(deps, { sessionId: '' }, 'jobs-create', { objective: 'o', cwd: 'D:/p', source: ref })
    expect(r.status).toBe(200)
    expect(deps.getState().jobs[0].source).toBeUndefined()
    expect(r.body).not.toHaveProperty('source')
  })

  it('is on job.created', async () => {
    const deps = makeDeps()
    const before = deps.getState()
    await handleCommand(deps, { sessionId: '' }, 'jobs-create', { objective: 'o', cwd: 'D:/p', [JOB_SOURCE]: ref })
    const [e] = derivePublicEvents(before, deps.getState())
    expect(e).toMatchObject({ type: 'job.created', payload: { source: ref } })
  })
})
