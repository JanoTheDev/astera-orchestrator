// The owner's case of 2026-11-03: two Gates answered from the CLI (`astera questions answer`) stayed in Needs you as
// "Needs your answer" with an answer box, and after Host restarts the window had to be reopened. These tests drive the
// workspace poll the panel reads (useWorkspaceData's source on the shared poll) against a fake of main: its state
// generation, its 'orch:moved' push and its orch.command answers.
import { describe, it, expect, vi } from 'vitest'
import type { Gate } from '../../../core/orchestration/types'
import { createSharedPoll } from './sharedPoll'
import { readWorkspace, workspaceSource, type WorkspaceApi } from './useWorkspaceData'
import type { WorkspaceData } from './workspaceTree'
import { needsOf, type QuestionRow } from '../components/inbox/inboxView'

const fakeDoc = () => {
  const t = new EventTarget() as EventTarget & { hidden: boolean }
  t.hidden = false
  return t
}

const gate = (id: string, status: 'open' | 'resolved'): Gate =>
  ({ id, runId: 'run_1', taskId: `tsk_${id}`, question: 'Could not record the worktree', status, createdAt: '2026-11-03T10:37:38.375Z' }) as unknown as Gate

/** Main as the window sees it: a mirror of the Host's state, its generation, and the push it sends when that moves. */
function fakeMain() {
  const state = {
    projects: [{ id: 'prj_1', path: 'C:\\repo', name: 'repo' }],
    gates: [gate('gat_1f8787fdcc9b07a0', 'open'), gate('gat_d217729fea4ca5fc', 'open')],
    tasks: [{ id: 'tsk_1', status: 'running' }]
  }
  let generation = 1
  const listeners = new Set<() => void>()
  const failing = new Set<string>()
  let reachable = true
  const answer = (cmd: string, args: Record<string, unknown>): { status: number; body: unknown } => {
    if (!reachable) return { status: 409, body: { error: 'orchestration is not running yet' } }
    if (failing.has(cmd)) return { status: 503, body: { error: 'the Host did not answer' } }
    switch (cmd) {
      case 'projects-list':
        return { status: 200, body: state.projects }
      case 'questions-list':
        return { status: 200, body: state.gates.filter((g) => args.status === undefined || g.status === args.status) }
      case 'tasks-list':
        return { status: 200, body: state.tasks }
      default:
        return { status: 200, body: [] }
    }
  }
  const api: WorkspaceApi = {
    command: vi.fn(async (_p: string, cmd: string, args: Record<string, unknown>) => answer(cmd, args)),
    homeDir: async () => 'C:\\Users\\me',
    worktreePaths: vi.fn(async () => [{ path: 'C:\\wt\\a', repoPath: 'C:\\repo' }]),
    generation: async () => generation,
    onMoved: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  return {
    api,
    state,
    failing,
    /** A commit made elsewhere reached main's mirror: its generation moves and main pushes 'orch:moved'. */
    commit(change: () => void, push = true): void {
      change()
      generation++
      if (push) for (const l of listeners) l()
    },
    setReachable(v: boolean): void {
      reachable = v
    }
  }
}

const cardsOf = (d: WorkspaceData | undefined) =>
  needsOf({
    items: [],
    questions: (d?.gates ?? []) as unknown as QuestionRow[],
    jobs: [],
    plans: new Map([['job_1', { projectName: 'repo', planName: 'Right-to-left' }]]),
    jobOfRun: new Map([['run_1', 'job_1']]),
    taskTitles: new Map(),
    events: []
  })

describe('Needs you stays current without reopening the window', () => {
  it('a Gate answered from the CLI leaves the panel as soon as main pushes the move', async () => {
    vi.useFakeTimers()
    try {
      const main = fakeMain()
      const poll = createSharedPoll<WorkspaceData>(5_000, fakeDoc())
      let data: WorkspaceData | undefined
      const off = poll.subscribe('C:\\repo', workspaceSource('C:\\repo', main.api), (d) => (data = d))
      await vi.advanceTimersByTimeAsync(0)
      expect(cardsOf(data).map((c) => c.kind)).toEqual(['gate', 'gate'])

      // `astera questions answer gat_1f8787fdcc9b07a0 retry`, made outside the window
      main.commit(() => (main.state.gates[0]!.status = 'resolved'))
      await vi.advanceTimersByTimeAsync(0) // no poll turn has passed: the push alone did it
      expect(data!.gates.map((g) => g.id)).toEqual(['gat_d217729fea4ca5fc'])
      expect(cardsOf(data)).toHaveLength(1)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a missed push is caught by the next turn: the generation moved', async () => {
    vi.useFakeTimers()
    try {
      const main = fakeMain()
      const poll = createSharedPoll<WorkspaceData>(5_000, fakeDoc())
      let data: WorkspaceData | undefined
      const off = poll.subscribe('k', workspaceSource('C:\\repo', main.api), (d) => (data = d))
      await vi.advanceTimersByTimeAsync(0)
      const reads = (main.api.command as ReturnType<typeof vi.fn>).mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      // two turns with nothing moved read no list again
      expect((main.api.command as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads)
      main.commit(() => main.state.gates.forEach((g) => (g.status = 'resolved')), false)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(data!.gates).toEqual([])
      expect(cardsOf(data)).toEqual([])
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resolved Gate leaves even while another list cannot be read; that list keeps what was held', async () => {
    const main = fakeMain()
    const first = await readWorkspace('C:\\repo', undefined, main.api)
    main.state.gates[1]!.status = 'resolved'
    main.state.tasks = [{ id: 'tsk_1', status: 'done' }]
    main.failing.add('tasks-list')
    const second = await readWorkspace('C:\\repo', first, main.api)
    expect(second!.gates.map((g) => g.id)).toEqual(['gat_1f8787fdcc9b07a0'])
    expect(second!.tasks).toBe(first!.tasks)
  })

  it('a list that never answers does not hold the others: its part is kept and the read ends', async () => {
    vi.useFakeTimers()
    try {
      const main = fakeMain()
      const first = await readWorkspace('C:\\repo', undefined, main.api)
      main.state.gates.forEach((g) => (g.status = 'resolved'))
      ;(main.api.worktreePaths as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
      const pending = readWorkspace('C:\\repo', first, main.api, 1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      const second = await pending
      expect(second!.gates).toEqual([])
      expect(second!.worktrees).toEqual(first!.worktrees)
    } finally {
      vi.useRealTimers()
    }
  })

  it('after a Host restart (main answers nothing for a while), the panel catches up once main refilled its mirror', async () => {
    vi.useFakeTimers()
    try {
      const main = fakeMain()
      const poll = createSharedPoll<WorkspaceData>(5_000, fakeDoc())
      let data: WorkspaceData | undefined
      const off = poll.subscribe('k', workspaceSource('C:\\repo', main.api), (d) => (data = d))
      await vi.advanceTimersByTimeAsync(0)
      expect(data!.gates).toHaveLength(2)
      // the Host restarts: main cannot answer, and while it is gone a Gate is answered from the CLI
      main.setReachable(false)
      main.commit(() => (main.state.gates[0]!.status = 'resolved'))
      await vi.advanceTimersByTimeAsync(15_000)
      expect(data!.gates).toHaveLength(2) // nothing readable: the panel keeps what it held rather than going empty
      // the new Host answers; main's refill lands and moves the generation, which pushes 'orch:moved'
      main.setReachable(true)
      main.commit(() => {})
      await vi.advanceTimersByTimeAsync(0)
      expect(data!.gates.map((g) => g.id)).toEqual(['gat_d217729fea4ca5fc'])
      off()
    } finally {
      vi.useRealTimers()
    }
  })
})
