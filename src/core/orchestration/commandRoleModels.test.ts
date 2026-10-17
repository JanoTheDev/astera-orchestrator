// worker-start records the model its start used on the Dispatch (orchestrator W1-A) — the field the UI
// reads to show which model did the work, and modelNote, why it is not what the Task asked for.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'

const NOW = '2026-10-17T00:00:00.000Z'

const makeDeps = (started: Awaited<ReturnType<OrchServerDeps['startWorker']>>): OrchServerDeps => {
  let state: OrchState = emptyState()
  return {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => started,
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps
}

const startOne = async (deps: OrchServerDeps) => {
  const call = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: 'coordinator' }, cmd, args)
  const run = await call('run-create', { objective: 'o', cwd: 'D:/p' })
  const runId = (run.body as { id: string }).id
  const task = await call('task-create', { account: 'acc1', runId, title: 't', spec: 's' })
  const taskId = (task.body as { id: string }).id
  const r = await call('worker-start', { taskId, agent: 'claude', account: 'acc1', worktree: 'current' })
  expect(r.status).toBe(200)
  return deps.getState().dispatches[0]
}

describe('worker-start — role models (W1-A)', () => {
  it('records the model and its note on the Dispatch', async () => {
    const d = await startOne(makeDeps({ sessionId: 's1', cwd: 'D:/p', specPath: 'D:/s.md', model: 'opus', modelNote: 'why' }))
    expect(d).toMatchObject({ sessionId: 's1', model: 'opus', modelNote: 'why' })
  })

  it('leaves both out when the start used the CLI default', async () => {
    const d = await startOne(makeDeps({ sessionId: 's1', cwd: 'D:/p', specPath: 'D:/s.md' }))
    expect(d).not.toHaveProperty('model')
    expect(d).not.toHaveProperty('modelNote')
  })
})
