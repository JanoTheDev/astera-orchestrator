// Stall watchdog (owner 2026-10-18): each stall detected from Host state alone and remedied once, a healthy plan left
// alone, and nothing at all with the setting off.
import { describe, expect, it } from 'vitest'
import { DROPPED_ASK_MS, HOLD_ASK_MS, LEASE_ASK_MS, LEASE_TELL_MS, PLANNER_IDLE_MS, PLANNER_NUDGE, PLANNER_RESTART_MS, BACKOFF_MS, BUSY_REFRESH_MS, BUSY_TELL_MS, DEAD_COORDINATOR_MS, DRAFT_STALL_MS, IDLE_NUDGE, IDLE_STALL_MS, LOST_STALL_MS, MERGE_STALL_MS, READY_STALL_MS, STALL_WATCH_MS, TRIES, VALIDATE_STALL_MS, createStallWatch, stallRemedies, type StallEntry, type StallWatchDeps, type StallProbe, type StallRemedy } from './stallWatch'
import { INSTALL_START_WINDOW_MS, isInstallingStart } from './stallWatch'
import { SETUP_SLOT_WAIT_MS, SETUP_TIMEOUT_MS } from '../../worktrees/setup'
import { PENDING_START_WINDOW_MS } from '../command'
import { startPauseOf } from '../usageGuard'
import { createDispatchLoop, type DispatchLoopContext } from './dispatchLoop'
import { emptyState, type OrchState } from '../state'
import type { ActivityDraft } from '../activity'
import type { Dispatch, Job, Task } from '../types'
import { mergedIntoPlan } from '../finishedSessions'
import { adoptLiveWorkers, type LiveWorker } from './adopt'
import type { Account } from '../../types'

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

/** A running plan its coordinator places, with two slots. T7: its project keeps same-file Tasks apart (serial files). */
function plan(over: Partial<OrchState> = {}, job: Partial<Job> = {}): OrchState {
  return {
    ...emptyState(),
    projects: [{ id: 'prj', path: '/p', name: 'p', addedAt: NOW, serialFiles: true }],
    jobs: [{ id: 'job_1', objective: 'Plan A', cwd: '/p', projectId: 'prj', createdAt: NOW, concurrency: 2, autoDispatch: false, ...job }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt1', coordinatorSessionId: 'coord-1' }],
    tasks: [task({ id: 'tsk_1' })],
    ...over
  }
}

const idle: StallProbe = { busy: () => false, isRegistered: (p) => p === '/wt-child' }

const label = (d: StallRemedy): string | number =>
  'task' in d ? d.task.id : 'sessionId' in d ? d.sessionId : 'done' in d ? d.done : 'taskId' in d ? d.taskId : d.runId

/** Runs the pure check at each time, carrying the memo, and lists every remedy by kind and Task (or session). */
function watch(s: OrchState, times: number[], probe: StallProbe = idle): string[] {
  let memo = new Map<string, StallEntry>()
  const out: string[] = []
  for (const t of times) {
    const r = stallRemedies(s, t, memo, probe)
    memo = r.memo
    for (const d of r.due) out.push(`${d.kind}:${label(d)}`)
  }
  return out
}
const every30s = (to: number): number[] => Array.from({ length: Math.floor(to / STALL_WATCH_MS) + 1 }, (_, i) => T0 + i * STALL_WATCH_MS)

describe('stallRemedies', () => {
  it('a ready Task with a free slot and no worker: told at 2 min, started 2 min later, then nothing', () => {
    expect(watch(plan(), every30s(5 * MIN))).toEqual(['tell-start:tsk_1', 'place:tsk_1'])
    expect(watch(plan(), [T0 + READY_STALL_MS - 1])).toEqual([])
  })

  it('a ready Task whose start keeps being refused is started again after a growing wait, then raised to the owner once', () => {
    const got: [string, number][] = []
    let memo = new Map<string, StallEntry>()
    for (const t of every30s(120 * MIN)) {
      const r = stallRemedies(plan(), t, memo, idle)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, (t - T0) / MIN])
    }
    // told at 2, placed 2, 5, 10 and 20 min after each try, raised 20 min after the last
    expect(got).toEqual([
      ['tell-start:tsk_1', 2], ['place:tsk_1', 4], ['place:tsk_1', 9], ['place:tsk_1', 19], ['place:tsk_1', 39], ['escalate:tsk_1', 59]
    ])
    expect(TRIES).toBe(4)
    expect(BACKOFF_MS).toEqual([2 * MIN, 5 * MIN, 10 * MIN, 20 * MIN])
    // Raised already (its message is in the inbox): not again, after a restart (an empty memo) either
    let subject = ''
    memo = new Map()
    for (const t of every30s(60 * MIN)) {
      const r = stallRemedies(plan(), t, memo, idle)
      memo = r.memo
      for (const d of r.due) if (d.kind === 'escalate') subject = d.subject
    }
    expect(subject).toBe(`watchdog: task tsk_1 ready since ${NOW} has no worker`)
    const marked = plan({ messages: [{ id: 'm', runId: 'run_1', type: 'escalation', subject, body: '', answered: false, createdAt: NOW }] })
    expect(watch(marked, every30s(60 * MIN)).filter((x) => x.startsWith('escalate'))).toEqual([])
  })

  it('a ready Task held by a blocker that clears is a new stall: told and started again, not dropped', () => {
    // started-and-refused once, then held by another worker on the same files, then free again
    const free = plan({ tasks: [task({ id: 'tsk_1', affectedPaths: ['src/a.ts'] })] })
    const held = plan(
      {
        tasks: [task({ id: 'tsk_1', affectedPaths: ['src/a.ts'] }), task({ id: 'tsk_2', status: 'dispatched', affectedPaths: ['src/a.ts'] })],
        dispatches: [{ ...ended('tsk_2', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch]
      },
      { concurrency: 3 }
    )
    const busyWorker: StallProbe = { ...idle, busy: (id) => id === 'w-tsk_2' }
    let memo = new Map<string, StallEntry>()
    const got: [string, number][] = []
    for (const t of every30s(40 * MIN)) {
      const m = (t - T0) / MIN
      const s = m < 5 ? free : m < 30 ? held : free
      const r = stallRemedies(s, t, memo, busyWorker)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, m])
    }
    expect(got).toEqual([['tell-start:tsk_1', 2], ['place:tsk_1', 4], ['tell-start:tsk_1', 32], ['place:tsk_1', 34], ['place:tsk_1', 39]])
  })

  it('free slots are spent only on Tasks that can start now, under the plan cap and the app-wide cap', () => {
    // three slots, one worker on src/a.ts: tsk_1 waits for it and takes no slot, so tsk_2 and tsk_3 are both told
    const s = plan(
      {
        tasks: [
          task({ id: 'tsk_1', affectedPaths: ['src/a.ts'] }),
          task({ id: 'tsk_2', affectedPaths: ['src/b.ts'] }),
          task({ id: 'tsk_3', affectedPaths: ['src/c.ts'] }),
          task({ id: 'tsk_r', status: 'dispatched', affectedPaths: ['src/a.ts'] })
        ],
        dispatches: [{ ...ended('tsk_r', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch]
      },
      { concurrency: 3 }
    )
    const probe: StallProbe = { ...idle, busy: (id) => id === 'w-tsk_r' }
    expect(watch(s, every30s(3 * MIN), probe)).toEqual(['tell-start:tsk_2', 'tell-start:tsk_3'])
    // The app-wide cap of 2 has one slot left (the running worker holds the other): one Task told
    expect(watch(s, every30s(3 * MIN), { ...probe, cap: 2 })).toEqual(['tell-start:tsk_2'])
    expect(watch(s, every30s(3 * MIN), { ...probe, cap: 1 })).toEqual([])
  })

  it('a Task whose wave is not open is no stall: never told or started', () => {
    // tsk_0 completed outside its paths, so tsk_1, which builds on it, waits for a replan (replan.ts waveOpen)
    const s = plan(
      { tasks: [task({ id: 'tsk_0', status: 'completed', affectedPaths: ['src/a'], filesModified: ['src/b'] }), task({ id: 'tsk_1', deps: ['tsk_0'] })], dispatches: [ended('tsk_0', '/wt1')] },
      { plannerSessionIds: ['pl'], coordinatorAccountId: 'accA' }
    )
    expect(watch(s, every30s(60 * MIN)).filter((x) => !x.startsWith('draft-pr'))).toEqual([])
  })

  it('a Run with a coordinator account and no coordinator, with ready work: restarted after 2 min, with backoff, then raised', () => {
    const dead = plan({ runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt1' }] }, { coordinatorAccountId: 'accA' })
    let memo = new Map<string, StallEntry>()
    const got: [string, number][] = []
    for (const t of every30s(80 * MIN)) {
      const r = stallRemedies(dead, t, memo, idle)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, (t - T0) / MIN])
    }
    expect(got).toEqual([['restart:run_1', 2], ['restart:run_1', 4], ['restart:run_1', 9], ['restart:run_1', 19], ['escalate:tsk_1', 39]])
    expect(DEAD_COORDINATOR_MS).toBe(2 * MIN)
    // No coordinator account (the app places it), no work, or a live external coordinator: nothing
    const appPlaced = plan({ runs: dead.runs })
    expect(watch(appPlaced, every30s(30 * MIN))).toEqual([])
    expect(watch({ ...dead, tasks: [task({ id: 'tsk_1', status: 'completed' })] }, every30s(30 * MIN)).filter((x) => x.startsWith('restart'))).toEqual([])
    const external = { ...dead, runs: [{ ...dead.runs[0], externalCoordinatorSessionId: 'ext' }] }
    expect(watch(external, every30s(30 * MIN), { ...idle, alive: () => true })).toEqual([])
    expect(watch(external, every30s(3 * MIN), { ...idle, alive: () => false })).toEqual(['restart:run_1'])
  })

  it('a dispatched Task whose worker ended unreported: retried after 2 min with backoff, then raised; at its retry limit raised at once', () => {
    const lost = (prior = 0): OrchState =>
      plan({
        tasks: [task({ id: 'tsk_1', status: 'dispatched' })],
        dispatches: [
          ...Array.from({ length: prior }, (_, i) => ({ ...ended('tsk_1', '/wt1'), id: `dsp_old${i}`, outcome: undefined, startedAt: '2026-10-17T00:00:00.000Z' }) as Dispatch),
          { ...ended('tsk_1', '/wt1'), outcome: undefined } as Dispatch
        ]
      })
    let memo = new Map<string, StallEntry>()
    const got: [string, number][] = []
    for (const t of every30s(80 * MIN)) {
      const r = stallRemedies(lost(), t, memo, idle)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, (t - T0) / MIN])
    }
    expect(got).toEqual([['retry-lost:tsk_1', 2], ['retry-lost:tsk_1', 4], ['retry-lost:tsk_1', 9], ['retry-lost:tsk_1', 19], ['escalate:tsk_1', 39]])
    expect(LOST_STALL_MS).toBe(2 * MIN)
    // lost FAILURE_LIMIT times: no more retries, the owner
    expect(watch(lost(2), every30s(30 * MIN))).toEqual(['escalate:tsk_1'])
    // A Run with no coordinator has the lost-worker Gate (lostGate.ts), not this
    expect(watch({ ...lost(), runs: [{ ...lost().runs[0], coordinatorSessionId: undefined }] }, every30s(30 * MIN))).toEqual([])
  })

  it.each(['claude', 'codex'] as const)('an idle %s worker without worker-done: nudged at 10 min, the coordinator told, then raised', (provider) => {
    const s = plan({
      tasks: [task({ id: 'tsk_1', status: 'dispatched' })],
      dispatches: [{ ...ended('tsk_1', '/wt1'), provider, endedAt: undefined, outcome: undefined } as Dispatch]
    })
    let memo = new Map<string, StallEntry>()
    const got: [string, number][] = []
    for (const t of every30s(60 * MIN)) {
      const r = stallRemedies(s, t, memo, idle)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, (t - T0) / MIN])
    }
    expect(got).toEqual([['nudge-worker:tsk_1', 10], ['tell-idle:tsk_1', 12], ['escalate:tsk_1', 17]])
    expect(IDLE_STALL_MS).toBe(10 * MIN)
    // Working again before 10 min: the clock starts over
    const flicker = (t: number): StallProbe => ({ ...idle, busy: () => (t - T0) / MIN === 8 })
    memo = new Map()
    const kinds: string[] = []
    for (const t of every30s(15 * MIN)) {
      const r = stallRemedies(s, t, memo, flicker(t))
      memo = r.memo
      kinds.push(...r.due.map((d) => d.kind))
    }
    expect(kinds).toEqual([])
  })

  it('a ready Task without a free slot, held, paused or on a paused account is no stall', () => {
    const full = plan({
      tasks: [task({ id: 'tsk_1' }), task({ id: 'tsk_2', status: 'dispatched' })],
      dispatches: [{ ...ended('tsk_2', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch]
    }, { concurrency: 1 })
    expect(watch(full, every30s(20 * MIN), { ...idle, busy: (id) => id === 'w-tsk_2' })).toEqual([])
    expect(watch(plan({}, { dispatchHold: true } as Partial<Job>), every30s(20 * MIN))).toEqual([])
    expect(watch(plan({}, { paused: true }), every30s(20 * MIN))).toEqual([])
    // T11: never started, but never silent either: a feed line, then one owner question
    expect(watch(plan(), every30s(20 * MIN), { ...idle, paused: () => true })).toEqual(['note-dropped:tsk_1', 'ask:tsk_1'])
  })

  // T1: "Pick accounts automatically" on: a start rolls to an account with room, so neither Task is dropped
  it('auto on: an auto Task, or one whose first account is paused while another has room, is started, not dropped', () => {
    const auto: StallProbe = { ...idle, autoAccounts: true }
    expect(watch(plan({ tasks: [task({ id: 'tsk_1', accountIds: [] })] }), every30s(5 * MIN), auto)).toEqual(['tell-start:tsk_1', 'place:tsk_1'])
    const pause = { accountId: 'accA', window: 'seven_day' as const, percent: 99, resetsAt: null }
    const accounts = [{ id: 'accA' }, { id: 'accB' }]
    const room = startPauseOf((id) => (id === 'accA' ? pause : null), { auto: true, accounts, loggedInIds: new Set(['accA', 'accB']) })
    expect(watch(plan(), every30s(5 * MIN), { ...auto, paused: (id) => room(id) !== null })).toEqual(['tell-start:tsk_1', 'place:tsk_1'])
    // auto off: dropped as before
    expect(watch(plan({ tasks: [task({ id: 'tsk_1', accountIds: [] })] }), every30s(20 * MIN))).toEqual(['note-dropped:tsk_1', 'ask:tsk_1'])
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
    expect(watch(s, every30s(10 * MIN)).filter((x) => !x.startsWith('draft-pr'))).toEqual(['merge:tsk_1'])
    expect(watch(s, [T0 + MERGE_STALL_MS - 1])).toEqual([])
    // marked merged (the wave merge's message): nothing
    const marked = { ...s, messages: [{ id: 'm', runId: 'run_1', type: 'status' as const, subject: 'task tsk_1 merged into the plan', body: '', answered: false, createdAt: NOW }] }
    expect(watch(marked, every30s(10 * MIN)).filter((x) => !x.startsWith('draft-pr'))).toEqual([])
  })

  it('a wave done with its draft PR not opened is asked again after 2 min, once', () => {
    // Two waves by deps; a `pr` delivery is the default
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'completed' }), task({ id: 'tsk_2', deps: ['tsk_1'] })], dispatches: [ended('tsk_1', '/wt1')] })
    const got = watch(s, every30s(10 * MIN)).filter((x) => x.startsWith('draft-pr'))
    expect(got).toEqual(['draft-pr:1'])
    expect(watch(s, [T0, T0 + DRAFT_STALL_MS - STALL_WATCH_MS]).filter((x) => x.startsWith('draft-pr'))).toEqual([])
  })

  // T2: a start whose fork's install waits for a heavy slot holds its `pending:install:` placeholder for many minutes
  it('a worker start waiting on its install is in flight for INSTALL_START_WINDOW_MS, not a stuck coordinator or a lost start', () => {
    const starting = (sessionId: string): OrchState =>
      plan(
        {
          tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_2' })],
          dispatches: [{ ...ended('tsk_1', '/wt-a'), sessionId, specPath: '', endedAt: undefined, outcome: undefined } as Dispatch]
        },
        { concurrency: 3 }
      )
    const busy: StallProbe = { ...idle, busy: (id) => (id === 'coord-1' ? true : null) }
    // Within its window: nothing is done about the start, its Run or its busy coordinator
    expect(watch(starting('pending:install:ab12cd34'), every30s(INSTALL_START_WINDOW_MS - MIN), busy)).toEqual([])
    // A plain placeholder reads as a dead start after two minutes, so the Run is watched again
    expect(watch(starting('pending:ab12cd34'), every30s(15 * MIN), busy)).toEqual(
      expect.arrayContaining(['tell-start:tsk_2', 'tell-busy:coord-1', 'refresh:coord-1'])
    )
    // Past its own window the install placeholder is read the same way
    const past = T0 + INSTALL_START_WINDOW_MS
    expect(watch(starting('pending:install:ab12cd34'), every30s(15 * MIN).map((t) => t + past), busy)).toEqual(
      expect.arrayContaining(['tell-start:tsk_2', 'tell-busy:coord-1', 'refresh:coord-1'])
    )
    expect(isInstallingStart('pending:install:ab12cd34')).toBe(true)
    expect(isInstallingStart('pending:ab12cd34')).toBe(false)
    // Nor is it a worker idle at its prompt, even where an unknown session reads as idle: it has no session yet
    const alone = plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })], dispatches: starting('pending:install:ab12cd34').dispatches })
    expect(watch(alone, every30s(INSTALL_START_WINDOW_MS - MIN), idle)).toEqual([])
  })

  it('INSTALL_START_WINDOW_MS outlasts the longest install start: the slot wait, the install, then the session start', () => {
    expect(INSTALL_START_WINDOW_MS).toBeGreaterThan(SETUP_SLOT_WAIT_MS + SETUP_TIMEOUT_MS + PENDING_START_WINDOW_MS)
  })

  it('a healthy plan gets nothing: its worker is working and nothing waits', () => {
    const s = plan({
      tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_2', status: 'completed' })],
      dispatches: [{ ...ended('tsk_1', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch, ended('tsk_2', '/wt1')]
    })
    // T3: the plan branch push after the completed Task is the driving loop's; nothing else waits
    expect(watch(s, every30s(60 * MIN), { ...idle, busy: () => true }).filter((x) => !x.startsWith('draft-pr'))).toEqual([])
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
    expect(h.lines.map((l) => l.payload.reason).filter((x) => !x?.includes('plan branch after'))).toEqual(['Merged TSK_1 into the plan branch; it had waited since it completed'])
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
      'The plan branch after 1 task(s) is still not pushed: its plan branch was not pushed after 1 task(s), retried later: {"error":"no remote push access"}'
    ])
  })

  it('setting off: nothing, however long the stall', async () => {
    const h = rig(plan(), false)
    for (let t = 0; t <= 30 * MIN; t += STALL_WATCH_MS) await h.at(t)
    expect(h.cmds).toEqual([])
    expect(h.lines).toEqual([])
  })
})

// The Host's applier for the remedies the loop does not apply: each through the existing command, one feed line each.
function watchRig(
  s0: OrchState,
  busy: (id: string) => boolean | null = () => false,
  live: LiveWorker[] = [],
  alive: (id: string) => boolean = () => false,
  answer: (cmd: string, args: Record<string, unknown>) => { status: number; body: unknown } | undefined = () => undefined,
  extra: Partial<StallWatchDeps> = {}
) {
  let state = s0
  let clock = T0
  const cmds: { cmd: string; args: Record<string, unknown> }[] = []
  const typed: string[] = []
  const told: string[] = []
  const lines: string[] = []
  const w = createStallWatch({
    handle: async (cmd, args) => {
      cmds.push({ cmd, args })
      const given = answer(cmd, args)
      if (given) return given
      if (cmd === 'send')
        state = {
          ...state,
          messages: [...state.messages, { id: `m${cmds.length}`, runId: 'run_1', type: args.type as 'escalation', subject: String(args.subject), body: String(args.body), answered: false, createdAt: NOW }]
        }
      return { status: 200, body: {} }
    },
    getState: () => state,
    on: () => true,
    cap: () => null,
    busy,
    alive,
    isRegistered: () => false,
    typeInto: (id, text) => typed.push(`${id}:${text}`),
    tell: async (n) => (told.push(n.subject), true),
    activity: (d) => lines.push(String(d.payload.reason)),
    adopt: async () => {
      const r = adoptLiveWorkers(state, live, '/specs', NOW)
      state = r.state
      return r.adopted
    },
    accounts: () => [{ id: 'accA', provider: 'codex' } as Account],
    mayStart: () => true,
    log: () => {},
    nowMs: () => clock,
    wait: async () => {},
    ...extra
  })
  return {
    cmds, typed, told, lines,
    state: () => state,
    run: async (to: number) => {
      for (let t = 0; t <= to; t += STALL_WATCH_MS) {
        clock = T0 + t
        await w.watch()
      }
    }
  }
}

describe('createStallWatch', () => {
  it('restarts a dead coordinator through run-start (the Jobs list restart), with a feed line', async () => {
    const h = watchRig(plan({ runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt1' }] }, { coordinatorAccountId: 'accA' }))
    await h.run(3 * MIN)
    expect(h.cmds).toEqual([{ cmd: 'run-start', args: { run: 'run_1' } }])
    expect(h.lines).toEqual(['Restarted the coordinator: it was gone 2 min with work waiting (try 1 of 4)'])
  })

  it('retries a lost worker on an account with room when its own is paused for usage', async () => {
    const paused = (cmd: string, args: Record<string, unknown>) =>
      cmd === 'worker-start' && args.account === 'accA' ? { status: 409, body: { error: 'at 99%', usagePaused: 'accA' } } : undefined
    const h = watchRig(plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })], dispatches: [{ ...ended('tsk_1', '/wt1'), outcome: undefined } as Dispatch] }), undefined, undefined, undefined, paused)
    await h.run(3 * MIN)
    expect(h.cmds.map((c) => c.args)).toEqual([
      { task: 'tsk_1', agent: 'claude', account: 'accA', retryOf: 'dsp_tsk_1' },
      { task: 'tsk_1', agent: 'claude', retryOf: 'dsp_tsk_1' }
    ])
    expect(h.lines).toEqual(['Started TSK_1 again: its worker ended without a report (try 1 of 4)'])
  })

  it('retries a lost worker with --retry-of on its account and agent, and leaves the ready-Task remedies to the loop', async () => {
    const h = watchRig(plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_2' })], dispatches: [{ ...ended('tsk_1', '/wt1'), provider: 'codex', outcome: undefined } as Dispatch] }))
    await h.run(3 * MIN)
    expect(h.cmds).toEqual([{ cmd: 'worker-start', args: { task: 'tsk_1', agent: 'codex', account: 'accA', retryOf: 'dsp_tsk_1' } }])
    expect(h.told).toEqual([])
    expect(h.lines).toEqual(['Started TSK_1 again: its worker ended without a report (try 1 of 4)'])
  })

  it('an idle worker: typed the nudge and Enter, then the coordinator told, then one escalation in the Inbox', async () => {
    const h = watchRig(plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })], dispatches: [{ ...ended('tsk_1', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch] }))
    await h.run(40 * MIN)
    expect(h.typed).toEqual([`w-tsk_1:${IDLE_NUDGE}`, 'w-tsk_1:\r'])
    expect(h.told).toEqual([`watchdog: worker dsp_tsk_1 idle since ${new Date(T0).toISOString()}`])
    const escalations = h.cmds.filter((c) => c.cmd === 'send' && c.args.type === 'escalation')
    expect(escalations).toHaveLength(1)
    expect(escalations[0].args).toMatchObject({ taskId: 'tsk_1', dispatchId: 'dsp_tsk_1' })
    expect(h.lines.map((l) => l.split(':')[0])).toEqual(['Nudged the worker of TSK_1', 'Told the coordinator the worker of TSK_1 is idle 12 min without reporting', 'Raised it to you'])
  })

  // Run job_0b682db7df32e7b4: the record of a live worker was lost, and the watchdog started a duplicate
  it('adopts a live worker running the spec of a dispatched Task with no Dispatch, and starts no worker', async () => {
    const live: LiveWorker[] = [{ id: 'ses_orig', spec: '--task-id tsk_1 --dispatch-id dsp_orig', cwd: '/wt1', accountId: 'accA' }]
    const h = watchRig(plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })] }), () => true, live)
    await h.run(10 * MIN)
    expect(h.cmds).toEqual([])
    expect(h.state().dispatches).toEqual([expect.objectContaining({ id: 'dsp_orig', taskId: 'tsk_1', sessionId: 'ses_orig' })])
    expect(h.lines).toEqual(['Adopted the worker of TSK_1: it ran with no record of its start'])
  })

  it('a dispatched Task with no Dispatch and no live worker is lost: started again on its account’s agent', async () => {
    const h = watchRig(plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })] }))
    await h.run(3 * MIN)
    expect(h.cmds).toEqual([{ cmd: 'worker-start', args: { task: 'tsk_1', agent: 'codex', account: 'accA' } }])
    expect(h.lines).toEqual(['Started TSK_1 again: its worker ended without a report (try 1 of 4)'])
  })
})

describe('stallRemedies: a dispatched Task with no Dispatch', () => {
  it('is retried after 2 min, then raised to the owner once, never left silent', () => {
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })] })
    expect(watch(s, [T0 + LOST_STALL_MS - 1])).toEqual([])
    expect(watch(s, every30s(60 * MIN))).toEqual([...Array<string>(TRIES).fill('retry-lost:tsk_1'), 'escalate:tsk_1'])
  })

  it('in a Run with no coordinator it is raised to the owner once after LOST_STALL_MS, never retried', () => {
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })] })
    const bare = { ...s, runs: [{ ...s.runs[0], coordinatorSessionId: undefined }] }
    expect(watch(bare, [T0 + LOST_STALL_MS - 1])).toEqual([])
    expect(watch(bare, every30s(60 * MIN))).toEqual(['escalate:tsk_1'])
  })

  it('a Task with a Dispatch on record is not untracked', () => {
    const s = plan({ tasks: [task({ id: 'tsk_1', status: 'dispatched' })], dispatches: [{ ...ended('tsk_1', '/wt1'), endedAt: undefined, outcome: undefined } as Dispatch] })
    expect(watch(s, every30s(5 * MIN), { ...idle, busy: () => true })).toEqual([])
  })
})

describe('no silent stalls (T11)', () => {
  /** Runs the pure check every 30 s up to `to` and lists each remedy with the minute it came due. */
  const timeline = (s: OrchState, to: number, probe: StallProbe = idle): [string, number][] => {
    let memo = new Map<string, StallEntry>()
    const got: [string, number][] = []
    for (const t of every30s(to)) {
      const r = stallRemedies(s, t, memo, probe)
      memo = r.memo
      for (const d of r.due) got.push([`${d.kind}:${label(d)}`, (t - T0) / MIN])
    }
    return got
  }

  /** job_0 (older) has a done, undelivered Task on src/a.ts; job_1's ready tsk_1 needs src/: it waits on the lease. */
  const leased = (over: Partial<OrchState> = {}): OrchState => {
    const s = plan()
    return {
      ...s,
      jobs: [{ ...s.jobs[0], id: 'job_0', objective: 'Plan Z', createdAt: '2026-10-17T00:00:00.000Z' }, s.jobs[0]],
      runs: [{ id: 'run_0', jobId: 'job_0', ordinal: 1, createdAt: NOW, worktree: '/wt0', coordinatorSessionId: 'coord-0' }, ...s.runs],
      tasks: [task({ id: 'tsk_0', runId: 'run_0', jobId: 'job_0', status: 'completed', affectedPaths: ['src/a.ts'] }), task({ id: 'tsk_1', affectedPaths: ['src/'] })],
      ...over
    }
  }

  it('a lease wait tells the coordinator once at 30 min and asks the owner once at 2 h', () => {
    const got = timeline(leased(), 4 * 60 * MIN).filter(([k]) => k.startsWith('tell-lease') || k.startsWith('ask'))
    expect(got).toEqual([['tell-lease:tsk_1', LEASE_TELL_MS / MIN], ['ask:tsk_1', LEASE_ASK_MS / MIN]])
    expect(LEASE_TELL_MS).toBe(30 * MIN)
    expect(LEASE_ASK_MS).toBe(120 * MIN)
    // asked already ("Let it wait"): never again
    const gate = { id: 'g', runId: 'run_1', taskId: 'tsk_1', question: 'q', options: ['Let it wait', 'Run it now anyway', 'Cancel this Task'], status: 'resolved' as const, resolution: 'Let it wait', createdAt: NOW }
    expect(timeline(leased({ gates: [gate] }), 4 * 60 * MIN).filter(([k]) => k.startsWith('ask'))).toEqual([])
  })

  it('T7: without serial files nothing waits on a lease: no lease line, no owner question, the Task is started', () => {
    const off = leased({ projects: [{ id: 'prj', path: '/p', name: 'p', addedAt: NOW }] })
    const got = timeline(off, 4 * 60 * MIN)
    expect(got.filter(([k]) => k.startsWith('tell-lease') || k.startsWith('ask'))).toEqual([])
    expect(got.map(([k]) => k)).toContain('place:tsk_1')
  })

  it('a Task the watchdog cannot start: a feed line at once, one owner question at 15 min, nothing more', () => {
    for (const t of [task({ id: 'tsk_1', consecutiveFailures: 3 }), task({ id: 'tsk_1', accountIds: [] })])
      expect(timeline(plan({ tasks: [t] }), 90 * MIN)).toEqual([['note-dropped:tsk_1', 0], ['ask:tsk_1', DROPPED_ASK_MS / MIN]])
  })

  it('a hold 30 min old with no open owner question raises one; with one open, none', () => {
    expect(timeline(plan({}, { dispatchHold: true }), 120 * MIN)).toEqual([['escalate:tsk_1', HOLD_ASK_MS / MIN]])
    expect(timeline(plan({}, { paused: true }), 120 * MIN)).toEqual([['escalate:tsk_1', HOLD_ASK_MS / MIN]])
    const open = { id: 'g', runId: 'run_1', taskId: 'tsk_1', question: 'q', status: 'open' as const, createdAt: NOW }
    expect(timeline(plan({ gates: [open] }, { dispatchHold: true }), 120 * MIN)).toEqual([])
  })

  it('a replan held 30 min re-notifies the owner once, its own question open or not, and not again after a restart', () => {
    const replanning = { replanning: { startedAt: NOW } } as unknown as Partial<Job>
    const asked = { id: 'm', runId: 'run_1', type: 'escalation' as const, subject: 'replan question', body: '', answered: false, createdAt: NOW }
    const got = timeline(plan({ messages: [asked] }, { dispatchHold: true, ...replanning }), 120 * MIN)
    expect(got).toEqual([['escalate:tsk_1', 30]])
    const r = stallRemedies(plan({}, { dispatchHold: true, ...replanning }), T0 + 31 * MIN, new Map(), idle).due[0]
    const raised = { ...asked, id: 'm2', subject: r.kind === 'escalate' ? r.subject : '' }
    expect(timeline(plan({ messages: [raised] }, { dispatchHold: true, ...replanning }), 120 * MIN)).toEqual([])
  })

  /** A plan still planning, auto planning, its planner `pl`. */
  const planning = (job: Partial<Job> = {}): OrchState => ({
    ...emptyState(),
    jobs: [{ id: 'job_1', objective: 'Plan A', cwd: '/p', createdAt: NOW, autoDispatch: false, pendingStart: true, plannerSessionIds: ['pl'], planning: 'auto', ...job }]
  })

  it('a planner idle without handing over: nudged at 20 min, restarted 10 min later, raised once after, in that order', () => {
    expect(timeline(planning(), 180 * MIN)).toEqual([
      ['nudge-planner:pl', PLANNER_IDLE_MS / MIN],
      ['restart-planner:pl', (PLANNER_IDLE_MS + PLANNER_RESTART_MS) / MIN],
      ['raise-planner:job_1', (2 * PLANNER_IDLE_MS + PLANNER_RESTART_MS) / MIN]
    ])
    // gone: nothing to nudge, restarted at 20 min, raised 20 min later
    expect(timeline(planning(), 180 * MIN, { ...idle, alive: () => false })).toEqual([['restart-planner:pl', 20], ['raise-planner:job_1', 40]])
    // working, handed over, chat planning (it waits on the person): nothing
    expect(timeline(planning(), 180 * MIN, { ...idle, busy: () => true })).toEqual([])
    expect(timeline(planning({ planReadyAt: NOW }), 180 * MIN)).toEqual([])
    expect(timeline(planning({ planning: 'chat' }), 180 * MIN)).toEqual([])
  })

  it('the Host nudges, restarts (old planner closed, a usable account) and raises the planner through its commands', async () => {
    const h = watchRig(planning({ plannerAccountId: 'accP' }), () => false, [], () => true)
    await h.run(180 * MIN)
    expect(h.cmds.map((c) => c.cmd)).toEqual(['sessions-send', 'sessions-close', 'jobs-plan'])
    expect(h.cmds[0].args).toEqual({ id: 'pl', text: PLANNER_NUDGE })
    expect(h.cmds[2].args).toEqual({ id: 'job_1', account: 'accP' })
    expect(h.lines.at(-1)).toMatch(/^The planner of Plan A stopped without handing its plan over/)
  })

  it('two plans planning with overlapping paths: each planner session is told once', async () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [
        { id: 'job_a', objective: 'Plan A', cwd: '/p', createdAt: NOW, autoDispatch: false, pendingStart: true, plannerSessionIds: ['pa'], overlaps: [{ taskId: 'ta', jobId: 'job_b', otherTaskId: 'tb', by: 'path', path: 'src/x.ts' }] },
        { id: 'job_b', objective: 'Plan B', cwd: '/p', createdAt: NOW, autoDispatch: false, pendingStart: true, plannerSessionIds: ['pb'], overlaps: [{ taskId: 'tb', jobId: 'job_a', otherTaskId: 'ta', by: 'path', path: 'src/' }] }
      ],
      tasks: [task({ id: 'ta', runId: undefined, jobId: 'job_a', status: 'pending' }), task({ id: 'tb', runId: undefined, jobId: 'job_b', status: 'pending' })]
    }
    // busy planners: only the overlap notices
    const h = watchRig(s, () => true, [], () => true)
    await h.run(30 * MIN)
    expect(h.cmds.filter((c) => c.cmd === 'sessions-send').map((c) => c.args.id).sort()).toEqual(['pa', 'pb'])
  })
})

// 2026-10-25: a typecheck's exit was lost, and its Task sat `validating` 45+ min with nothing checking it
describe('a lost validation', () => {
  /** tsk_1 validating since NOW, its worker's Dispatch ended in /wt-t1. */
  const lost = (over: Partial<Task> = {}): OrchState =>
    plan({ tasks: [task({ id: 'tsk_1', status: 'validating', ...over })], dispatches: [ended('tsk_1', '/wt-t1')] })
  const nobody: StallProbe = { ...idle, checking: () => false }

  it('is restarted after VALIDATE_STALL_MS in its implementation folder, with backoff, then raised to the owner once', () => {
    expect(watch(lost(), [T0 + VALIDATE_STALL_MS - 1], nobody)).toEqual([])
    const r = stallRemedies(lost(), T0 + VALIDATE_STALL_MS, new Map(), nobody).due
    expect(r).toMatchObject([{ kind: 'revalidate', cwd: '/wt-t1', try: 1 }])
    expect(watch(lost(), every30s(120 * MIN), nobody)).toEqual([...Array<string>(TRIES).fill('revalidate:tsk_1'), 'escalate:tsk_1'])
  })

  it('is no stall while a check of it is queued or running, with its Dispatch open, or with no check probe', () => {
    expect(watch(lost(), every30s(30 * MIN), { ...idle, checking: () => true })).toEqual([])
    expect(watch(lost(), every30s(30 * MIN))).toEqual([])
    const open = { ...lost(), dispatches: [{ ...ended('tsk_1', '/wt-t1'), endedAt: undefined, outcome: undefined } as Dispatch] }
    expect(watch(open, every30s(30 * MIN), { ...nobody, busy: () => true })).toEqual([])
  })

  it('the Host starts its validation again through startValidation, with a feed line', async () => {
    const started: unknown[] = []
    const h = watchRig(lost(), () => false, [], () => false, () => undefined, {
      checking: () => false,
      startValidation: (a) => started.push(a)
    })
    await h.run(VALIDATE_STALL_MS)
    expect(started).toEqual([{ taskId: 'tsk_1', cwd: '/wt-t1' }])
    expect(h.lines).toEqual(['Restarted the checks of TSK_1: it was validating 5 min with no check running (try 1 of 4)'])
  })
})
