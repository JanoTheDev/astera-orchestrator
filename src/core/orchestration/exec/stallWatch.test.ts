// Stall watchdog (owner 2026-10-18): each stall detected from Host state alone and remedied once, a healthy plan left
// alone, and nothing at all with the setting off.
import { describe, expect, it } from 'vitest'
import { BUSY_REFRESH_MS, BUSY_TELL_MS, DRAFT_STALL_MS, MERGE_STALL_MS, READY_STALL_MS, STALL_WATCH_MS, stallRemedies, type StallEntry, type StallProbe } from './stallWatch'
import { createDispatchLoop, type DispatchLoopContext } from './dispatchLoop'
import { emptyState, type OrchState } from '../state'
import type { ActivityDraft } from '../activity'
import type { Dispatch, Job, Task } from '../types'
import { mergedIntoPlan } from '../finishedSessions'

const NOW = '2026-10-18T00:00:00.000Z'
const T0 = Date.parse(NOW)
const MIN = 60_000

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  runId: 'run_1',
  jobId: 'job_1',
  title: over.id.toUpperCase(),
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['accA'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

const ended = (taskId: string, cwd: string): Dispatch =>
  ({ id: `dsp_${taskId}`, taskId, provider: 'claude', accountId: 'accA', sessionId: `w-${taskId}`, cwd, specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' }) as Dispatch

/** A running plan its coordinator places, with two slots. */
function plan(over: Partial<OrchState> = {}, job: Partial<Job> = {}): OrchState {
  return {
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'Plan A', cwd: '/p', createdAt: NOW, concurrency: 2, autoDispatch: false, ...job }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt1', coordinatorSessionId: 'coord-1' }],
    tasks: [task({ id: 'tsk_1' })],
    ...over
  }
}

const idle: StallProbe = { busy: () => false, isRegistered: (p) => p === '/wt-child' }

/** Runs the pure check at each time, carrying the memo, and lists every remedy by kind and Task (or session). */
function watch(s: OrchState, times: number[], probe: StallProbe = idle): string[] {
  let memo = new Map<string, StallEntry>()
  const out: string[] = []
  for (const t of times) {
    const r = stallRemedies(s, t, memo, probe)
    memo = r.memo
    for (const d of r.due) out.push(`${d.kind}:${'task' in d ? d.task.id : 'sessionId' in d ? d.sessionId : d.done}`)
  }
  return out
}
const every30s = (to: number): number[] => Array.from({ length: Math.floor(to / STALL_WATCH_MS) + 1 }, (_, i) => T0 + i * STALL_WATCH_MS)

describe('stallRemedies', () => {
  it('a ready Task with a free slot and no worker: told at 2 min, started 2 min later, then nothing', () => {
    expect(watch(plan(), every30s(20 * MIN))).toEqual(['tell-start:tsk_1', 'place:tsk_1'])
    expect(watch(plan(), [T0 + READY_STALL_MS - 1])).toEqual([])
  })

  it('a ready Task without a free slot, held, paused or on a paused account is no stall', () => {
    const full = plan({
      tasks: [task({ id: 'tsk_1' }), task({ id: 'tsk_2', status: 'dispatched' })],
      dispatches: [{ ...ended('tsk_2', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch]
    }, { concurrency: 1 })
    expect(watch(full, every30s(20 * MIN))).toEqual([])
    expect(watch(plan({}, { dispatchHold: true } as Partial<Job>), every30s(20 * MIN))).toEqual([])
    expect(watch(plan({}, { paused: true }), every30s(20 * MIN))).toEqual([])
    expect(watch(plan(), every30s(20 * MIN), { ...idle, paused: () => true })).toEqual([])
  })

  it('a coordinator busy 5 min with work waiting and nothing started is told, and refreshed at 10 min, once', () => {
    // A Task readied just now, so only the busy stall is due before 2 min... and the ready one after
    const s = plan()
    const busy = { ...idle, busy: () => true }
    const got = watch(s, every30s(30 * MIN), busy)
    expect(got.filter((x) => x.startsWith('tell-busy') || x.startsWith('refresh'))).toEqual(['tell-busy:coord-1', 'refresh:coord-1'])
    const told = every30s(30 * MIN).find((t) => {
      let memo = new Map<string, StallEntry>()
      for (const u of every30s(30 * MIN).filter((u) => u <= t)) memo = stallRemedies(s, u, memo, busy).memo
      return memo.get('busy:coord-1')!.step === 1
    })!
    expect(told - T0).toBe(BUSY_TELL_MS)
    expect(BUSY_REFRESH_MS).toBe(2 * BUSY_TELL_MS)
  })

  it('a busy coordinator that starts a worker, opens a Gate or acks its mail is not stuck', () => {
    const later = new Date(T0 + 4 * MIN).toISOString()
    const s = plan({
      tasks: [task({ id: 'tsk_1' }), task({ id: 'tsk_2', status: 'dispatched' })],
      dispatches: [{ ...ended('tsk_2', '/wt1'), startedAt: later, endedAt: undefined, outcome: undefined } as Dispatch]
    }, { concurrency: 3 })
    const busy = { ...idle, busy: () => true }
    const kinds = watch(s, every30s(8 * MIN), busy).filter((x) => x.startsWith('tell-busy'))
    // The worker it started at 4 min restarts the clock: told at 9 min, past this window
    expect(kinds).toEqual([])
    expect(watch(s, every30s(10 * MIN), busy).filter((x) => x.startsWith('tell-busy'))).toEqual(['tell-busy:coord-1'])
  })

  it('a completed Task left out of the plan branch is merged again after 2 min, once', () => {
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'completed' })], dispatches: [ended('tsk_1', '/wt-child')] })
    expect(watch(s, every30s(10 * MIN))).toEqual(['merge:tsk_1'])
    expect(watch(s, [T0 + MERGE_STALL_MS - 1])).toEqual([])
    // marked merged (the wave merge's message): nothing
    const marked = { ...s, messages: [{ id: 'm', runId: 'run_1', type: 'status' as const, subject: 'task tsk_1 merged into the plan', body: '', answered: false, createdAt: NOW }] }
    expect(watch(marked, every30s(10 * MIN))).toEqual([])
  })

  it('a wave done with its draft PR not opened is asked again after 2 min, once', () => {
    // Two waves by deps; a `pr` delivery is the default
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'completed' }), task({ id: 'tsk_2', deps: ['tsk_1'] })], dispatches: [ended('tsk_1', '/wt1')] })
    const got = watch(s, every30s(10 * MIN)).filter((x) => x.startsWith('draft-pr'))
    expect(got).toEqual(['draft-pr:1'])
    expect(watch(s, [T0, T0 + DRAFT_STALL_MS - STALL_WATCH_MS]).filter((x) => x.startsWith('draft-pr'))).toEqual([])
  })

  it('a healthy plan gets nothing: its worker is working and nothing waits', () => {
    const s = plan({
      tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_2', status: 'completed' })],
      dispatches: [{ ...ended('tsk_1', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch, ended('tsk_2', '/wt1')]
    })
    expect(watch(s, every30s(60 * MIN), { ...idle, busy: () => true })).toEqual([])
  })
})

describe('mergedIntoPlan reads the recorded merge', () => {
  it('a worktree Task nothing depends on is merged once recorded, or once its merge worker completed', () => {
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'completed' })], dispatches: [ended('tsk_1', '/wt-child')] })
    expect(mergedIntoPlan(s, s.tasks[0])).toBe(false)
    expect(mergedIntoPlan(s, { ...s.tasks[0], mergedIntoPlanAt: NOW })).toBe(true)
    const withMerge = { ...s, tasks: [...s.tasks, task({ id: 'tsk_m', parentId: 'tsk_1', status: 'completed' })] }
    expect(mergedIntoPlan(withMerge, s.tasks[0])).toBe(true)
  })
})

// The loop's wiring: each remedy applied once, each with one feed line; the setting off does nothing.
function rig(s0: OrchState, on = true) {
  let state = s0
  let clock = T0
  const cmds: { cmd: string; args: Record<string, unknown> }[] = []
  const lines: ActivityDraft[] = []
  const ctx: DispatchLoopContext = {
    handle: async (cmd, args) => {
      cmds.push({ cmd, args })
      if (cmd === 'worker-start') {
        const id = String(args.task)
        state = {
          ...state,
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, status: 'dispatched' as const } : t)),
          dispatches: [...state.dispatches, { ...ended(id, String(args.worktree ?? '/wt1')), endedAt: undefined, outcome: undefined, sessionId: 'w-new' } as Dispatch]
        }
        return { status: 200, body: { sessionId: 'w-new' } }
      }
      if (cmd === 'task-update' && args.mergedIntoPlan === true)
        state = { ...state, tasks: state.tasks.map((t) => (t.id === args.id ? { ...t, mergedIntoPlanAt: NOW } : t)) }
      if (cmd === 'send')
        state = {
          ...state,
          messages: [...state.messages, { id: `m${cmds.length}`, runId: 'run_1', type: 'status', subject: String(args.subject), body: String(args.body), answered: false, createdAt: new Date(clock).toISOString() }]
        }
      return { status: 200, body: {} }
    },
    getState: () => state,
    accounts: () => [{ id: 'accA', label: 'accA', configDir: '/c', color: '#000', createdAt: NOW, provider: 'claude' }],
    loginStatus: async () => true,
    lang: () => 'en',
    forkRunWorktree: async () => '/wt-forked',
    integrate: async () => ({ kind: 'merged', uncommitted: 0 }) as never,
    reap: async () => true,
    isRegisteredWorktree: (p) => p === '/wt-child',
    sessionAlive: () => true,
    sessionBusy: () => true,
    typeInto: () => {},
    stallWatch: () => on,
    activity: (d) => lines.push(d),
    mayStart: () => true,
    log: () => {},
    nowMs: () => clock
  }
  const loop = createDispatchLoop(ctx)
  return {
    loop,
    ctx,
    cmds,
    lines,
    state: () => state,
    setState: (s: OrchState) => (state = s),
    at: async (ms: number) => {
      clock = T0 + ms
      await loop.watchStalls()
    }
  }
}

describe('watchStalls', () => {
  it('a stuck ready Task: the exact start told, then started by Astera, one feed line each, never again', async () => {
    const h = rig(plan())
    h.ctx.sessionBusy = () => false
    for (let t = 0; t <= 20 * MIN; t += STALL_WATCH_MS) await h.at(t)
    const sends = h.cmds.filter((c) => c.cmd === 'send').map((c) => String(c.args.body))
    expect(sends[0]).toContain('astera worker-start --task tsk_1 --agent claude --account accA --json')
    expect(h.cmds.filter((c) => c.cmd === 'worker-start')).toHaveLength(1)
    const reasons = h.lines.map((l) => l.payload.reason)
    expect(reasons[0]).toMatch(/^Told the coordinator to start TSK_1: ready 2 min/)
    expect(reasons.some((r) => r === 'Started TSK_1, the coordinator had not in 4 min')).toBe(true)
    expect(h.lines.every((l) => l.type === 'watchdog' && l.runId === 'run_1' && l.payload.title === 'Plan A')).toBe(true)
  })

  it('a stuck coordinator: told what is ready at 5 min, refreshed at 10 min, once', async () => {
    // The ready Task's readiness is stamped later, so only the coordinator's own stall is due
    const h = rig(plan({ tasks: [task({ id: 'tsk_1', updatedAt: new Date(T0 + 60 * MIN).toISOString() })] }))
    for (let t = 0; t <= 20 * MIN; t += STALL_WATCH_MS) await h.at(t)
    const busyTold = h.cmds.filter((c) => c.cmd === 'send' && String(c.args.subject).startsWith('watchdog: coordinator busy'))
    expect(busyTold).toHaveLength(1)
    expect(String(busyTold[0].args.body)).toContain('tsk_1 (TSK_1) is ready and has no worker')
    const refresh = h.cmds.filter((c) => c.cmd === 'run-coordinator-refresh')
    expect(refresh).toHaveLength(1)
    expect(refresh[0].args).toMatchObject({ run: 'run_1', reason: 'watchdog: busy 10 min, nothing started' })
    // the refresh writes its own feed line (coordinator.refreshed); the watchdog adds one only for the tell
    expect(h.lines.map((l) => l.payload.reason)).toEqual(['The coordinator was busy 5 min with nothing started; told it what is ready'])
  })

  it('a completed Task out of the plan branch: merged, recorded on the Task, one line', async () => {
    const h = rig(plan({ tasks: [task({ id: 'tsk_1', status: 'completed' })], dispatches: [ended('tsk_1', '/wt-child')] }))
    h.ctx.sessionBusy = () => false
    let merges = 0
    h.ctx.integrate = async () => (merges++, { kind: 'merged', uncommitted: 0 }) as never
    for (let t = 0; t <= 10 * MIN; t += STALL_WATCH_MS) await h.at(t)
    expect(merges).toBe(1)
    expect(h.state().tasks[0].mergedIntoPlanAt).toBe(NOW)
    expect(h.lines.map((l) => l.payload.reason)).toEqual(['Merged TSK_1 into the plan branch; it had waited since it completed'])
  })

  it('a failed draft PR retry says why in the feed', async () => {
    const h = rig(
      plan({
        tasks: [task({ id: 'tsk_1', status: 'completed' }), task({ id: 'tsk_2', status: 'dispatched', deps: ['tsk_1'] })],
        dispatches: [ended('tsk_1', '/wt1'), { ...ended('tsk_2', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch]
      })
    )
    h.ctx.sessionBusy = () => false
    const real = h.ctx.handle
    h.ctx.handle = async (cmd, args) => (cmd === 'run-draft-pr' ? { status: 409, body: { error: 'no remote push access' } } : real(cmd, args))
    for (let t = 0; t <= 10 * MIN; t += STALL_WATCH_MS) await h.at(t)
    expect(h.lines.map((l) => l.payload.reason)).toEqual([
      'The draft PR after wave 1 is still not opened or updated: its draft pull request after wave 1 was not updated: {"error":"no remote push access"}'
    ])
  })

  it('setting off: nothing, however long the stall', async () => {
    const h = rig(plan(), false)
    for (let t = 0; t <= 30 * MIN; t += STALL_WATCH_MS) await h.at(t)
    expect(h.cmds).toEqual([])
    expect(h.lines).toEqual([])
  })
})
