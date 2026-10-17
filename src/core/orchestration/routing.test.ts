// W3-D session routing (SPEC §6 "orchestrator instructions must reach the correct session", §12 "switching plans must
// never route input to the wrong plan"). Two plans run side by side, each with two workers; every command that
// reaches a worker session by id, or a worker reaching the orchestrator, must touch plan A's worker 2 and nothing of
// plan B's.
import { describe, it, expect, vi } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { releaseArgsFor } from './exec/release'
import type { Dispatch, Job, JobRun, Task } from './types'

const T0 = '2026-10-17T00:00:00.000Z'

const job = (id: string, cwd: string): Job => ({ id, objective: id, cwd, createdAt: T0, concurrency: 3 })
const run = (id: string, jobId: string, coordinator: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0, coordinatorSessionId: coordinator, worktree: `/wt/${id}` })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id, runId, title: id, spec: 's', deps: [], status: 'dispatched', accountIds: ['acc_1'], consecutiveFailures: 0, createdAt: T0, updatedAt: T0, ...over
})
const dispatch = (id: string, taskId: string, sessionId: string, startedAt: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'acc_1', sessionId, cwd: `/wt/${id}`, specPath: `/spec/${id}.md`, startedAt, workerState: 'working', retained: false, ...over }) as Dispatch

/** Plans A and B in two projects. Their workers started interleaved (A1, B1, A2, B2), so "worker 2" of either
 *  plan is not the second Dispatch of the state. A1 is finished; its session is still alive (workers wait after
 *  reporting) and may be reused by its own run. A3 is ready. */
const twoPlans = (): OrchState => {
  const s = emptyState()
  s.projects.push({ id: 'pA', path: '/repos/a', name: 'a', addedAt: T0 }, { id: 'pB', path: '/repos/b', name: 'b', addedAt: T0 })
  s.jobs.push(job('jA', '/repos/a'), job('jB', '/repos/b'))
  s.runs.push(run('rA', 'jA', 'coordA'), run('rB', 'jB', 'coordB'))
  s.tasks.push(
    task('A1', 'rA', { status: 'completed' }),
    task('A2', 'rA'),
    task('A3', 'rA', { status: 'ready' }),
    task('B1', 'rB'),
    task('B2', 'rB')
  )
  s.dispatches.push(
    dispatch('dA1', 'A1', 'sA1', '2026-10-17T01:00:00.000Z', { outcome: 'succeeded', endedAt: '2026-10-17T01:30:00.000Z' }),
    dispatch('dB1', 'B1', 'sB1', '2026-10-17T02:00:00.000Z'),
    dispatch('dA2', 'A2', 'sA2', '2026-10-17T03:00:00.000Z'),
    dispatch('dB2', 'B2', 'sB2', '2026-10-17T04:00:00.000Z')
  )
  return s
}

const live = (id: string, cwd: string): HostSession => ({ id, kind: 'terminal', title: id, accountId: 'acc_1', cwd, alive: true, state: 'unknown' })

const rig = () => {
  const box = { state: twoPlans() }
  const sendSession = vi.fn(async () => {})
  const startWorker = vi.fn(async (a: { terminal?: string }) => ({ sessionId: a.terminal ?? 'sNew', cwd: '/wt/new', specPath: '/spec/new.md' }))
  const releaseWorker = vi.fn(async () => {})
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker,
    releaseWorker,
    listAccounts: () => [{ id: 'acc_1', label: 'one', provider: 'claude' as const }],
    readWorker: async () => '',
    now: () => T0,
    listSessions: async () => [
      live('sA1', '/wt/dA1'), live('sA2', '/wt/dA2'), live('sB1', '/wt/dB1'), live('sB2', '/wt/dB2'),
      live('coordA', '/wt/rA'), live('coordB', '/wt/rB')
    ],
    readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
    sendSession,
    readChat: async () => [],
    chatSend: vi.fn(async () => ({ sent: true as const }))
  } as unknown as OrchServerDeps
  const as = (sessionId: string) => (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, cmd, args)
  return { deps, box, sendSession, startWorker, releaseWorker, as }
}

const error = (r: { body: unknown }): string => (r.body as { error: string }).error

describe('routing an instruction to plan A worker 2', () => {
  it('sessions send types into exactly that session, once, whoever sends it', async () => {
    for (const from of ['', 'coordA']) {
      const h = rig()
      const r = await h.as(from)('sessions-send', { id: 'sA2', text: 'also cover the empty case' })
      expect(r.status, from).toBe(200)
      expect(h.sendSession, from).toHaveBeenCalledTimes(1)
      expect(h.sendSession, from).toHaveBeenCalledWith('sA2', 'also cover the empty case', true)
    }
  })

  it('sessions list --project names plan A’s sessions only, though both plans’ worktrees are outside their projects', async () => {
    const h = rig()
    const r = await h.as('')('sessions-list', { project: '/repos/a' })
    expect(r.status).toBe(200)
    expect((r.body as HostSession[]).map((x) => x.id).sort()).toEqual(['coordA', 'sA1', 'sA2'])
  })

  it('worker stop and release close that Dispatch’s own session and touch no other', async () => {
    const h = rig()
    expect((await h.as('coordA')('worker-stop', { dispatch: 'dA2' })).status).toBe(200)
    expect(h.releaseWorker).toHaveBeenCalledTimes(1)
    expect(h.releaseWorker).toHaveBeenCalledWith({ dispatchId: 'dA2' })
    // the wiring turns that id into the session it kills (spawner.ts / ipc.ts releaseWorker)
    expect(releaseArgsFor(h.box.state.dispatches, 'dA2')).toEqual({ sessionId: 'sA2', retained: false, isLatestOwner: true })
    const stopped = h.box.state.dispatches.filter((d) => d.closedBy === 'stop').map((d) => d.id)
    expect(stopped).toEqual(['dA2'])
    expect(h.box.state.dispatches.find((d) => d.id === 'dB2')).toMatchObject({ workerState: 'working' })
  })
})

describe('a plan never reaches another plan’s worker', () => {
  it('worker-start --terminal refuses another run’s session before anything is typed', async () => {
    const h = rig()
    const r = await h.as('coordA')('worker-start', { taskId: 'A3', agent: 'claude', account: 'acc_1', terminal: 'sB1' })
    expect(r.status).toBe(403)
    expect(error(r)).toContain('not of run rA')
    expect(h.startWorker).not.toHaveBeenCalled()
    expect(h.box.state.dispatches).toHaveLength(4)
  })

  it('worker-start --terminal reuses its own run’s finished session, typing into that one', async () => {
    const h = rig()
    const r = await h.as('coordA')('worker-start', { taskId: 'A3', agent: 'claude', account: 'acc_1', terminal: 'sA1' })
    expect(r.status).toBe(200)
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.startWorker.mock.calls[0][0]).toMatchObject({ taskId: 'A3', terminal: 'sA1' })
    expect(h.box.state.dispatches.find((d) => d.taskId === 'A3')?.sessionId).toBe('sA1')
  })

  it('plan B’s worker cannot report or post for plan A’s worker 2, and nothing changes', async () => {
    const h = rig()
    const before = h.box.state
    const done = await h.as('sB1')('send', { type: 'worker_done', taskId: 'A2', dispatchId: 'dA2', outcome: 'succeeded', subject: 's', body: 'b' })
    expect(done.status).toBe(403)
    const status = await h.as('sB1')('send', { type: 'status', dispatchId: 'dA2', subject: 's', body: 'b' })
    expect(status.status).toBe(403)
    expect(h.box.state).toBe(before)
  })

  it('a worker’s own message lands on its own plan’s run and Dispatch', async () => {
    const h = rig()
    const r = await h.as('sA2')('send', { type: 'status', taskId: 'A2', subject: 'halfway', body: 'b' })
    expect(r.status).toBe(200)
    expect(h.box.state.messages.map((m) => [m.runId, m.dispatchId, m.taskId])).toEqual([['rA', 'dA2', 'A2']])
  })

  it('a worker’s report closes its own Dispatch only', async () => {
    const h = rig()
    const r = await h.as('sA2')('send', { type: 'worker_done', taskId: 'A2', dispatchId: 'dA2', outcome: 'succeeded', subject: 's', body: 'b' })
    expect(r.status).toBe(200)
    const open = h.box.state.dispatches.filter((d) => !d.endedAt).map((d) => d.id)
    expect(open).toEqual(['dB1', 'dB2'])
    expect(h.box.state.tasks.filter((t) => t.status === 'completed').map((t) => t.id)).toEqual(['A1', 'A2'])
  })
})
