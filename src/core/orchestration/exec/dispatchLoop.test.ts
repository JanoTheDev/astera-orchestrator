// createDispatchLoop(dispatchLoop.ts) — 앱(ipc.ts 의 bootOrch)과 Host 가 같은 것을 짓는 배치 루프.
//
// **진짜 handleCommand 위에서 돈다**(commitHook.test.ts 의 rig 와 같은 모양). 상태는 이 파일의 변수
// 하나이고, 가짜는 세션을 실제로 띄우는 startWorker 와 DispatchLoopContext 의 바깥 자리(계정·로그인·
// 워크트리·세션)뿐이다. **setState 는 상태를 갈아 끼운 뒤 `loop.run()` 을 다시 부른다** — 앱의 커밋
// 훅이 하는 일 그대로라(B4), 루프의 scheduleAgain 갈래가 운영에서처럼 돈다.
import { ORIGIN_SYNC_MARK } from './originSync'
import { describe, it, expect, vi } from 'vitest'
import {
  COORDINATOR_STOP_RETRY_CAP_TRIES,
  COORDINATOR_STOP_RETRY_MAX_MS,
  COORDINATOR_STOP_RETRY_MS,
  FINISHED_RUN_BUSY_CAP_MS,
  FINISHED_RUN_GRACE_MS,
  REPLAN_IDLE_NUDGE_MS,
  REPLAN_TIMEOUT_MS,
  createDispatchLoop, type DispatchLoop, type DispatchLoopContext,
  idleWorkersOf
} from './dispatchLoop'
import { coordinatorReleaseOf } from './releaseDefer'
import { REPLAN_LIFT_HOLD } from './replanStart'
import { handleCommand, type OrchServerDeps } from '../command'
import { createDispatchLoop as freshLoop } from './dispatchLoop'
import { DELIVERY_FIX_MARK, DELIVERY_OWNER_PUSHES, DELIVERY_RETRY_NOW } from '../delivery'
import { APP_CALLER } from '../../host/driver'
import { addDecision, COORDINATOR_START_WINDOW_MS, emptyState, type OrchState } from '../state'
import { needsInput } from '../sessionIndex'
import { outcomeOf } from '../running'
import { ASK_GRACE_MS } from './autoAnswer'
import type { Dispatch, Job, Message, Task } from '../types'
import { FAILURE_LIMIT } from '../types'
import type { Account } from '../../types'

const NOW = '2026-09-24T00:00:00.000Z'
const NOW_MS = Date.parse(NOW)

const claudeAccount = (id: string): Account => ({
  id,
  label: id,
  configDir: `/cfg/${id}`,
  color: '#000',
  createdAt: NOW,
  provider: 'claude'
})

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  runId: 'run_1',
  jobId: 'job_1',
  title: over.id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['accA'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

const message = (over: Partial<Message> & Pick<Message, 'id' | 'type'>): Message => ({
  runId: 'run_1',
  subject: 's',
  body: 'b',
  answered: false,
  createdAt: NOW,
  ...over
})

interface RigOpts {
  concurrency?: number
  /** T3: the Host's push delivery, so `run-deliver` on a push plan runs for real over it. */
  deliverPush?: OrchServerDeps['deliverPush']
  /** T1: the Host's GitHub (a fake gh runner and branch pushes) */
  github?: OrchServerDeps['github']
  /** 몇 번째 startWorker 호출(0부터)이 던지는가. 'all' 이면 전부. */
  startFailsFor?: number | 'all'
  /** gate-create 가 거절된다(열린 Dispatch 가 있는 Task 의 Gate 처럼). */
  gateRefused?: boolean
  /** 답할 코디네이터가 없는 Run 에서 워커 하나가 질문을 두고 기다린다. */
  question?: boolean
  /** 계정이 없는 ready Task 하나가 더 있다. */
  noAccountTask?: boolean
  /** 예약 템플릿 Job 하나가 더 있다. */
  schedule?: { every: 'minute' }
  /** 그 템플릿에 계정이 있는 정의 Task 하나. 발화가 그것을 회차로 복사한다. */
  scheduleTask?: boolean
  /** 그 템플릿의 코디네이터 계정. */
  scheduleCoordinator?: string
  /** 코디네이터가 있는 Run 에, 오래전에 온 읽지 않은 상향 메일이 있다. */
  coordinatorMail?: boolean
  /** Run 워크트리가 아직 없다 — 루프가 게으르게 만든다. */
  runWithoutWorktree?: boolean
  /** 끝난 예약 회차 하나 — 워크트리를 걷을 대상이다(reapableChildRuns). */
  reapableChild?: boolean
  /** The reap fails, as a locked worktree on Windows does. */
  reapFails?: boolean
  /** Every session is gone (a month of finished Runs whose workers ended long ago). */
  deadSessions?: boolean
}

const TEMPLATE_ID = 'job_sched'

function fixture(o: RigOpts): OrchState {
  const jobs: Job[] = [
    {
      id: 'job_1',
      objective: 'two ready tasks',
      cwd: '/p',
      createdAt: NOW,
      concurrency: o.concurrency ?? 1,
      autoDispatch: true
    }
  ]
  // 발화 판정이 보는 것은 Job 의 schedule 이다(fire.ts). 1분 간격 — fire.test.ts 의 규칙 모양이다.
  // **디스크에서 읽은 옛 예약 Job 과 같은 모양이다** — autoDispatch 도 pendingStart 도 없다(R2).
  if (o.schedule)
    jobs.push({
      id: TEMPLATE_ID,
      objective: 'every minute',
      cwd: '/p',
      createdAt: NOW,
      schedule: { kind: 'interval', minutes: 1 },
      ...(o.scheduleCoordinator ? { coordinatorAccountId: o.scheduleCoordinator } : {})
    })
  const tasks = [task({ id: 'tsk_1' }), task({ id: 'tsk_2' })]
  // 정의 Task — runId 가 없고 jobId 만 있다(task-create 가 Job 을 지목받았을 때의 모양).
  if (o.scheduleTask) {
    const { runId: _none, ...def } = task({ id: 'tsk_def', jobId: TEMPLATE_ID, status: 'pending' })
    tasks.push(def as Task)
  }
  if (o.noAccountTask) tasks.push(task({ id: 'tsk_na', accountIds: [] }))
  const state: OrchState = {
    ...emptyState(),
    jobs,
    runs: [
      {
        id: 'run_1',
        jobId: 'job_1',
        ordinal: 1,
        createdAt: NOW,
        ...(o.runWithoutWorktree ? {} : { worktree: '/wt1' }),
        ...(o.coordinatorMail ? { coordinatorSessionId: 'coord-1' } : {})
      }
    ],
    tasks
  }
  if (o.question) {
    // 이미 도는 워커 하나(한도 1 을 채운다)와 그 워커의 질문.
    state.tasks = [task({ id: 'tsk_q', status: 'dispatched' }), ...state.tasks]
    state.dispatches = [
      {
        id: 'dsp_q',
        taskId: 'tsk_q',
        provider: 'claude',
        accountId: 'accA',
        sessionId: 'sess_q',
        cwd: '/wt1',
        specPath: '/specs/q.md',
        startedAt: NOW,
        workerState: 'ready',
        retained: false
      }
    ]
    state.messages = [message({ id: 'msg_q', type: 'question', taskId: 'tsk_q', dispatchId: 'dsp_q' })]
  }
  if (o.coordinatorMail) {
    // COORDINATOR_NUDGE_MS(90초)보다 오래전에 왔고 아직 ack 되지 않았다.
    state.messages = [
      ...state.messages,
      message({ id: 'msg_up', type: 'status', createdAt: new Date(NOW_MS - 120_000).toISOString() })
    ]
  }
  if (o.reapableChild) {
    // 예약 Job 의 회차 하나. Task 가 전부 completed 이고 열린 Dispatch 가 없으므로 outcomeOf 가 completed 다.
    state.jobs = [...state.jobs, { id: 'job_rc', objective: 'scheduled', cwd: '/p', createdAt: NOW, schedule: { kind: 'interval', minutes: 60 } }]
    state.runs = [...state.runs, { id: 'run_rc', jobId: 'job_rc', ordinal: 1, createdAt: NOW, worktree: '/wt-child' }]
    state.tasks = [...state.tasks, task({ id: 'tsk_rc', runId: 'run_rc', jobId: 'job_rc', status: 'completed' })]
  }
  return state
}

type StartArgs = Parameters<OrchServerDeps['startWorker']>[0]

function rig(o: RigOpts = {}) {
  let state = fixture(o)
  const cmds: string[] = []
  const logs: string[] = []
  const typed: string[] = []
  const reaped: string[] = []
  const forked: { repoPath: string; name: string; base?: string }[] = []
  let calls = 0
  let inFlight = 0
  // 안전판: 회전하는 루프(attempted 를 지운 변이)가 이 파일을 멈춰 세우지 않고 횟수로 실패하게 한다.
  let commits = 0

  const startWorker = vi.fn(async (a: StartArgs) => {
    const n = calls++
    if (o.startFailsFor === 'all' || o.startFailsFor === n) throw new Error(`spawn ${n} failed`)
    return { sessionId: `s-${n}`, cwd: a.runCwd ?? 'x', specPath: 'x' }
  })
  const startCoordinator = vi.fn(async (a: { runId: string }) => ({ sessionId: `coord-${a.runId}` }))
  const stopCoordinator = vi.fn(async (_sessionId: string, _reason?: string): Promise<void> => {})
  const releaseWorker = vi.fn(async (_a: { dispatchId: string }): Promise<void> => {})

  const deps = {
    getState: () => state,
    // 앱의 커밋 훅처럼: 갈아 끼우고, 루프를 다시 부른다(B4). 종단 catch 는 앱의 schedule 과 같다.
    setState: async (next: OrchState) => {
      state = next
      if (++commits > 200) return
      inFlight++
      void loop
        .run()
        .catch(() => {})
        .finally(() => inFlight--)
    },
    now: () => new Date(h.clock).toISOString(),
    startWorker,
    startCoordinator,
    stopCoordinator,
    releaseWorker,
    listAccounts: async () => [{ id: 'accA', label: 'accA', provider: 'claude' as const }],
    // T5b: worker-start with no --account starts on the account with most room; here the one account
    startAccount: async () => ({ ok: true as const, accountId: 'accA', release: () => {} }),
    log: () => {},
    runningSessions: () => 0,
    appVersion: () => '1.0.0',
    ...(o.deliverPush ? { deliverPush: o.deliverPush } : {}),
    ...(o.github ? { github: o.github } : {})
  } as unknown as OrchServerDeps

  /** 진짜 command layer — 테스트가 ctx.handle 을 갈아 끼워도 그 안에서 부를 수 있게 따로 둔다. */
  const real = (cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
    if (o.gateRefused && cmd === 'gate-create')
      return Promise.resolve({ status: 409, body: { error: 'task has an open dispatch' } })
    return handleCommand(deps, { sessionId: APP_CALLER }, cmd, args)
  }

  const ctx: DispatchLoopContext = {
    handle: real,
    getState: () => state,
    accounts: () => [claudeAccount('accA')],
    loginStatus: async () => true,
    lang: () => 'en',
    forkRunWorktree: async (a) => {
      forked.push(a)
      return '/wt-forked'
    },
    integrate: async () => ({ kind: 'clean' }) as never,
    reap: async (p) => {
      reaped.push(p)
      return !o.reapFails
    },
    isRegisteredWorktree: (p) => p === '/wt-child',
    sessionAlive: () => !o.deadSessions,
    sessionBusy: () => false,
    typeInto: (_id, text) => {
      typed.push(text)
    },
    mayStart: () => true,
    log: (m) => {
      logs.push(m)
    },
    nowMs: () => h.clock
  }

  // 모듈은 c.* 를 부를 때마다 읽는다(C5) — 그래서 테스트가 ctx 의 칸을 갈아 끼우면 곧바로 먹는다.
  // handle 만은 이 겹을 지나 기록된다: 갈아 끼운 handle 이 부른 명령도 h.handled() 에 남는다.
  const recorded = new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'handle')
        return (cmd: string, args: Record<string, unknown>) => {
          // T3: the loop's mark that a Run it saw running has a delivery pending is bookkeeping, not a step under test
          if (!(cmd === 'run-deliver' && args.pending === true)) cmds.push(cmd)
          return target.handle(cmd, args)
        }
      return Reflect.get(target, key, receiver)
    }
  })
  const loop: DispatchLoop = createDispatchLoop(recorded)

  const h = {
    clock: NOW_MS,
    ctx,
    loop,
    real,
    /** The real command layer, called by an agent session (the rig's own `real` is the app). */
    as: (sessionId: string, cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, cmd, args),
    startWorker,
    startCoordinator,
    stopCoordinator,
    releaseWorker,
    logs,
    typed,
    reaped,
    forked,
    templateRunId: TEMPLATE_ID,
    state: () => state,
    /** Replaces the state outside any command, as a change nobody commits through the loop would. */
    setState: (next: OrchState): void => {
      state = next
    },
    handled: () => [...cmds],
    /** 떠 있는 run() 이 없을 때까지 — 마지막 handle 이 풀린 뒤 두 macrotask. */
    settle: async (): Promise<void> => {
      for (;;) {
        await new Promise<void>((r) => setImmediate(r))
        await new Promise<void>((r) => setImmediate(r))
        if (inFlight === 0) return
      }
    }
  }
  return h
}

describe('createDispatchLoop', () => {
  it('fills the free slot through worker-start and nothing else', async () => {
    const h = rig()
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.handled()).toEqual(['worker-start'])
  })

  it("T4: an origin sync's open integration Task holds the Run's new Tasks", async () => {
    const h = rig()
    const merge = task({ id: 'tsk_sync', parentId: 'tsk_1', status: 'failed', spec: `${ORIGIN_SYNC_MARK} origin/main moved on` })
    h.setState({ ...h.state(), tasks: [...h.state().tasks, merge] })
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).not.toHaveBeenCalled()
  })

  it('asks mayStart before every slot: a driver that changes mid-activation starts no further slot (§4.3)', async () => {
    const h = rig({ concurrency: 2 })
    let allowed = 2 // the entry check, then the first slot (B4)
    h.ctx.mayStart = () => allowed-- > 0
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when mayStart is false on entry', async () => {
    const h = rig()
    h.ctx.mayStart = () => false
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toEqual([])
  })

  // W1-B.
  it('places no more than the app-wide cap, under a larger Job concurrency', async () => {
    const h = rig({ concurrency: 2 })
    h.ctx.maxConcurrentWorkers = async () => 1
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  it('a worker-start held at the app-wide cap (atCapacity) opens no Gate', async () => {
    const h = rig({ concurrency: 2 })
    h.ctx.handle = async (cmd, args) =>
      cmd === 'worker-start'
        ? { status: 409, body: { error: 'the app-wide worker cap is reached: 1 of 1 workers are open', atCapacity: true } }
        : h.real(cmd, args)
    await h.loop.run()
    await h.settle()
    expect(h.handled()).not.toContain('gate-create')
    expect(h.state().tasks.every((t) => t.status === 'ready')).toBe(true)
  })

  it('a worker-start refused at the Run concurrency limit (atRunLimit) opens no Gate and starts once a slot frees', async () => {
    const h = rig()
    let full = true
    h.ctx.handle = async (cmd, args) =>
      cmd === 'worker-start' && full
        ? { status: 409, body: { error: 'run run_x is at its concurrency limit: 5 of 5 dispatches are open', atRunLimit: true } }
        : h.real(cmd, args)
    await h.loop.run()
    await h.settle()
    expect(h.handled()).not.toContain('gate-create')
    expect(h.state().tasks.every((t) => t.status === 'ready')).toBe(true)
    full = false
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  // W6-G: the usage guard. A paused account starts nothing and opens no Gate; the pass after its end starts it.
  it('starts no worker on an account at usagePauseAt, opens no Gate, and starts once the pause ends', async () => {
    const h = rig()
    let paused = true
    const pause = { accountId: 'accA', window: 'five_hour' as const, percent: 93, resetsAt: '2026-09-24T02:00:00.000Z' }
    h.ctx.usageGuard = { refresh: async () => {}, pauseOf: (id) => (paused && id === 'accA' ? pause : null) }
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).not.toHaveBeenCalled()
    expect(h.handled()).not.toContain('gate-create')
    expect(h.state().tasks.every((t) => t.status === 'ready')).toBe(true)
    expect(h.logs.join('\n')).not.toContain('Gate')
    paused = false
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  it('starts on the next account of the chain that is under usagePauseAt', async () => {
    const h = rig()
    h.setState({ ...h.state(), tasks: h.state().tasks.map((t) => ({ ...t, accountIds: ['accA', 'accB'] })) })
    h.ctx.accounts = () => [claudeAccount('accA'), claudeAccount('accB')]
    const pause = { accountId: 'accA', window: 'seven_day' as const, percent: 95, resetsAt: null }
    h.ctx.usageGuard = { refresh: async () => {}, pauseOf: (id) => (id === 'accA' ? pause : null) }
    const starts: unknown[] = []
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'worker-start') starts.push(args.account)
      return h.real(cmd, args)
    }
    await h.loop.run()
    await h.settle()
    expect(starts[0]).toBe('accB')
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  // T2: "Pick accounts automatically". A one-account Task whose account is spent starts on another account of the
  // same provider when the setting is on, and waits as before when it is off.
  for (const on of [true, false]) {
    it(`a one-account Task at 95% with usagePauseAt 90 ${on ? 'starts on another account (setting on)' : 'waits (setting off)'}`, async () => {
      const h = rig()
      h.setState({ ...h.state(), tasks: h.state().tasks.map((t) => ({ ...t, accountIds: ['accA'] })) })
      h.ctx.accounts = () => [claudeAccount('accA'), claudeAccount('accB')]
      const later = '2026-09-24T02:00:00.000Z'
      const pause = { accountId: 'accA', window: 'five_hour' as const, percent: 95, resetsAt: later }
      h.ctx.usageGuard = {
        refresh: async () => {},
        pauseOf: (id) => (id === 'accA' ? pause : null),
        view: () => [
          { accountId: 'accA', session: { usedPercent: 95, resetsAt: later }, weekly: null, paused: pause },
          { accountId: 'accB', session: { usedPercent: 20, resetsAt: later }, weekly: null, paused: null }
        ],
        pauseAt: () => 90,
        autoAccounts: () => on
      }
      const starts: unknown[] = []
      h.ctx.handle = async (cmd, args) => {
        if (cmd === 'worker-start') starts.push(args.account)
        return h.real(cmd, args)
      }
      await h.loop.run()
      await h.settle()
      if (on) {
        expect(starts[0]).toBe('accB')
        expect(h.startWorker).toHaveBeenCalledTimes(1)
      } else {
        expect(starts).toEqual([])
        expect(h.startWorker).not.toHaveBeenCalled()
      }
      expect(h.handled()).not.toContain('gate-create')
    })
  }

  it('a worker-start refused for usage (usagePaused) opens no Gate', async () => {
    const h = rig({ concurrency: 2 })
    h.ctx.handle = async (cmd, args) =>
      cmd === 'worker-start'
        ? { status: 409, body: { error: 'account accA is at 93% of its 5-hour limit', usagePaused: { accountId: 'accA' } } }
        : h.real(cmd, args)
    await h.loop.run()
    await h.settle()
    expect(h.handled()).not.toContain('gate-create')
    expect(h.state().tasks.every((t) => t.status === 'ready')).toBe(true)
  })

  // W7-C (#73): a coordinator's held starts are retried on usage.resumed, with nobody typing a nudge.
  it('usage resumed: a coordinator-driven Run with held Tasks gets a status message its check --wait returns', async () => {
    const h = rig()
    const s0 = h.state()
    h.setState({
      ...s0,
      // T3: a scheduled Job's coordinator places its own Tasks; the app places every other coordinator's
      jobs: s0.jobs.map((j) => ({ ...j, autoDispatch: false, schedule: { kind: 'daily' as const, time: '09:00' } })),
      runs: [
        ...s0.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1' })),
        // a paused Run is not told: it places nothing
        { id: 'run_p', jobId: 'job_1', ordinal: 2, createdAt: NOW, coordinatorSessionId: 'coord-2', paused: true }
      ],
      tasks: [...s0.tasks, task({ id: 'tsk_p', runId: 'run_p' })]
    })
    await h.loop.usageResumed('accA')
    await h.settle()
    expect(h.startWorker).not.toHaveBeenCalled() // the coordinator places its own Tasks
    const told = h.state().messages.filter((m) => m.subject === 'usage resumed')
    expect(told.map((m) => m.runId)).toEqual(['run_1'])
    expect(told[0].body).toContain('tsk_1, tsk_2')
    const checked = await h.as('coord-1', 'check', { run: 'run_1', wait: true, timeoutMs: 1000 })
    expect((checked.body as { messages: Message[] }).messages.map((m) => m.subject)).toContain('usage resumed')
  })

  // W8-E (#96): the owner's answer to a Gate wakes the coordinator's check --wait, once, within one tick
  it('a resolved Gate ends a pending check --wait within one tick, and is told once', async () => {
    const h = rig()
    const s0 = h.state()
    h.setState({ ...s0, jobs: s0.jobs.map((j) => ({ ...j, autoDispatch: false })), runs: s0.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1' })) })
    const opened = await h.real('gate-create', { task: 'tsk_1', question: 'EUR or USD?\nPick one.' })
    expect(opened.status).toBe(200)
    const gateId = (opened.body as { id: string }).id
    const first = await h.as('coord-1', 'check', { run: 'run_1' })
    await h.as('coord-1', 'check', { run: 'run_1', ack: (first.body as { deliveryId: string }).deliveryId })
    let returned = false
    const waiting = h.as('coord-1', 'check', { run: 'run_1', wait: true, timeoutMs: 5000 }).then((r) => {
      returned = true
      return r
    })
    expect((await h.real('questions-answer', { id: gateId, answer: 'EUR' })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 120))
    expect(returned).toBe(false) // the answer alone is no inbox message
    await h.loop.nudge()
    const checked = await waiting
    const msgs = (checked.body as { messages: Message[] }).messages
    expect(msgs.map((m) => m.subject)).toEqual([`gate ${gateId} answered`])
    expect(msgs[0].body).toContain('EUR or USD?')
    expect(msgs[0].body).toContain('Answer: EUR')
    await h.loop.nudge()
    expect(h.state().messages.filter((m) => m.subject === `gate ${gateId} answered`)).toHaveLength(1)
  })

  // Push, not poll (owner 2026-10-18): the coordinator ends its turn; a report is told to it with the next action.
  // T3: a scheduled Job's coordinator places its own Tasks; the app places every other coordinator's
  const driven = (h: ReturnType<typeof rig>, over: Partial<OrchState> = {}): void => {
    const s0 = h.state()
    h.setState({
      ...s0,
      jobs: s0.jobs.map((j) => ({ ...j, autoDispatch: false, concurrency: 2, schedule: { kind: 'daily' as const, time: '09:00' } })),
      runs: s0.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1' })),
      ...over
    })
  }
  it("T3: the app starts a ready Task of a plan's coordinator Run itself, and tells the coordinator no worker-start", async () => {
    const h = rig()
    const s0 = h.state()
    h.setState({
      ...s0,
      jobs: s0.jobs.map((j) => ({ ...j, autoDispatch: false, concurrency: 2 })),
      runs: s0.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1' }))
    })
    await h.loop.run()
    await h.settle()
    await h.loop.nudge()
    expect(h.startWorker).toHaveBeenCalledTimes(2)
    expect(h.state().tasks.filter((t) => t.runId === 'run_1').every((t) => t.status === 'dispatched')).toBe(true)
    expect(h.state().messages.some((m) => /still ready|worker-start it/.test(`${m.subject} ${m.body}`))).toBe(false)
  })
  it("a worker's done report is told to the idle coordinator at the next tick, naming the Task it readied", async () => {
    const h = rig()
    driven(h, {
      tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_3', status: 'pending', deps: ['tsk_1'] })],
      dispatches: [{ id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'accA', sessionId: 'w-1', cwd: '/wt1', specPath: '', startedAt: NOW } as Dispatch]
    })
    const done = await h.as('w-1', 'send', { type: 'worker_done', taskId: 'tsk_1', dispatchId: 'dsp_1', outcome: 'succeeded', subject: 'a', body: 'b' })
    expect(done.status).toBe(200)
    await h.loop.nudge()
    const told = h.state().messages.filter((m) => m.subject === 'task tsk_1 completed')
    expect(told).toHaveLength(1)
    expect(told[0].body).toContain('tsk_3 (tsk_3) is ready and has no worker: worker-start it.')
    // typed at once: an idle coordinator waits in no `check --wait`, so there is no 90 s grace
    expect(h.typed.some((t) => t.includes('unread message'))).toBe(true)
    await h.loop.nudge()
    expect(h.state().messages.filter((m) => m.subject === 'task tsk_1 completed')).toHaveLength(1)
  })
  it('a ready Task with no worker for a minute while the coordinator is idle gets one reminder', async () => {
    const h = rig()
    driven(h, { tasks: [task({ id: 'tsk_1' })] })
    await h.loop.nudge()
    expect(h.state().messages.some((m) => m.subject.startsWith('task tsk_1 still ready'))).toBe(false)
    h.clock = NOW_MS + 61_000
    h.ctx.sessionBusy = () => true
    await h.loop.nudge()
    expect(h.state().messages.some((m) => m.subject.startsWith('task tsk_1 still ready'))).toBe(false)
    h.ctx.sessionBusy = () => false
    await h.loop.nudge()
    await h.loop.nudge()
    expect(h.state().messages.filter((m) => m.subject.startsWith('task tsk_1 still ready'))).toHaveLength(1)
  })
  // Part 2: a finished Task's branch that conflicts with the plan branch gets a merge worker; only its failure is the owner's.
  it('an integration conflict starts a merge worker, and its failure opens a Gate', async () => {
    const h = rig()
    driven(h, {
      tasks: [task({ id: 'tsk_1', status: 'completed' })],
      dispatches: [
        { id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'accA', sessionId: 'w-1', cwd: '/wt-child', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' } as Dispatch
      ]
    })
    const merges: string[][] = []
    h.ctx.integrate = async (_root, paths) => {
      merges.push(paths)
      return { kind: 'agent', reason: 'git merge-tree says a does not merge cleanly', worktrees: [{ path: '/wt-child', branch: 'a' }] }
    }
    await h.loop.nudge()
    expect(merges).toEqual([['/wt-child']])
    const merge = h.state().tasks.find((t) => t.parentId === 'tsk_1')!
    expect(merge.spec).toContain('git merge --no-edit refs/heads/a')
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.state().tasks.find((t) => t.id === merge.id)!.status).toBe('dispatched')
    expect(h.state().messages.some((m) => m.subject === `merge worker ${merge.id} started`)).toBe(true)
    await h.loop.nudge()
    expect(merges).toHaveLength(1) // the merge worker has it; not merged again, not a second worker
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    const d = h.state().dispatches.find((x) => x.taskId === merge.id)!
    const failed = await h.as(d.sessionId, 'send', { type: 'worker_done', taskId: merge.id, dispatchId: d.id, outcome: 'failed', subject: 'x', body: 'y' })
    expect(failed.status).toBe(200)
    await h.loop.nudge()
    expect(h.state().gates.filter((g) => g.taskId === merge.id && g.status === 'open')).toHaveLength(1)
    expect(h.state().tasks.find((t) => t.id === merge.id)!.status).toBe('blocked')
    await h.loop.nudge()
    expect(h.state().gates.filter((g) => g.taskId === merge.id)).toHaveLength(1)
  })
  it('writes the merge Task title and its Gate reason in the app language (en), with no Hangul', async () => {
    const h = rig()
    driven(h, {
      tasks: [task({ id: 'tsk_1', status: 'completed' })],
      dispatches: [
        { id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'accA', sessionId: 'w-1', cwd: '/wt-child', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' } as Dispatch
      ]
    })
    h.ctx.integrate = async () => ({ kind: 'agent', reason: 'it conflicts', worktrees: [{ path: '/wt-child', branch: 'a' }] })
    await h.loop.nudge()
    const merge = h.state().tasks.find((t) => t.parentId === 'tsk_1')!
    expect(merge.title).toBe(`Merge worktrees: ${h.state().tasks.find((t) => t.id === 'tsk_1')!.title}`.slice(0, 80))
    const d = h.state().dispatches.find((x) => x.taskId === merge.id)!
    await h.as(d.sessionId, 'send', { type: 'worker_done', taskId: merge.id, dispatchId: d.id, outcome: 'failed', subject: 'x', body: 'y' })
    await h.loop.nudge()
    const gate = h.state().gates.find((g) => g.taskId === merge.id)!
    expect(gate.question).toMatch(/^tsk_1's branch could not be merged into the plan branch \(.+\), and the merge worker failed too: the merge worker failed$/)
    expect(`${merge.title}\n${gate.question}`).not.toMatch(/[가-힣]/)
  })
  // T1: the merge worker never stops on accounts; a hands-off plan's conflicts are the merge worker's until it failed 3 times
  /** An app-driven Run whose tsk_A finished in /wt-child and waits for its merge, which `integrate` answers. */
  const mergingRig = (result: Awaited<ReturnType<DispatchLoopContext['integrate']>>, over: Partial<Task> = {}, handsOff = false) => {
    const h = rig()
    const s0 = h.state()
    h.setState({
      ...s0,
      jobs: s0.jobs.map((j) => ({ ...j, handsOff })),
      tasks: [task({ id: 'tsk_A', status: 'merging', ...over })],
      dispatches: [{ id: 'dsp_a', taskId: 'tsk_A', provider: 'claude', accountId: 'accA', sessionId: 'w-a', cwd: '/wt-child', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' } as Dispatch]
    })
    h.ctx.integrate = async () => result
    const starts: Record<string, unknown>[] = []
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'worker-start') starts.push(args)
      return h.real(cmd, args)
    }
    return { h, starts }
  }
  const conflict = { kind: 'agent' as const, reason: 'a does not merge cleanly', worktrees: [{ path: '/wt-child', branch: 'a' }] }
  const mergeTaskOf = (h: ReturnType<typeof rig>) => h.state().tasks.find((t) => t.parentId === 'tsk_A')!
  const failMerge = async (h: ReturnType<typeof rig>): Promise<void> => {
    const merge = mergeTaskOf(h)
    const d = h.state().dispatches.find((x) => x.taskId === merge.id && !x.endedAt)!
    const failed = await h.as(d.sessionId, 'send', { type: 'worker_done', taskId: merge.id, dispatchId: d.id, outcome: 'failed', subject: 'x', body: 'y' })
    expect(failed.status).toBe(200)
    await h.loop.nudge()
    await h.settle()
  }

  it('T1: a merge Task of a Task with no accounts starts on the account with most room and opens no Gate', async () => {
    const { h, starts } = mergingRig(conflict, { accountIds: [] })
    await h.loop.nudge()
    await h.settle()
    const merge = mergeTaskOf(h)
    expect(merge.accountIds ?? []).toEqual([])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ task: merge.id, agent: 'claude' })
    expect(starts[0]).not.toHaveProperty('account')
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.handled()).not.toContain('gate-create')
  })

  it('T1: a merge Task whose named account cannot be used starts on another account, with no Gate', async () => {
    const { h, starts } = mergingRig(conflict, { accountIds: ['accA'] })
    h.ctx.accounts = () => [claudeAccount('accA'), claudeAccount('accB')]
    h.ctx.loginStatus = async (id) => id !== 'accA'
    await h.loop.nudge()
    await h.settle()
    expect(starts).toHaveLength(1)
    expect(starts[0]).not.toHaveProperty('account')
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.handled()).not.toContain('gate-create')
  })

  it('T1: a merge Task gates only when no account of any provider is logged in, and never names a first assigned account', async () => {
    const { h, starts } = mergingRig(conflict, { accountIds: [] })
    h.ctx.loginStatus = async () => false
    await h.loop.nudge()
    await h.settle()
    expect(starts).toEqual([])
    const gate = h.state().gates.find((g) => g.taskId === mergeTaskOf(h).id)!
    expect(gate.status).toBe('open')
    expect(gate.question).not.toMatch(/first account/i)
    expect(gate.question).toMatch(/no account of any provider is signed in/i)
    expect(gate.question).not.toMatch(/claude/i)
  })

  it('T1: a hands-off plan retries a failed merge worker twice and asks the owner at the third failure', async () => {
    const { h, starts } = mergingRig(conflict, { accountIds: [] }, true)
    await h.loop.nudge()
    await h.settle()
    expect(starts).toHaveLength(1)
    for (const n of [2, 3]) {
      await failMerge(h)
      expect(starts).toHaveLength(n) // a fresh attempt, no owner Gate
      expect(h.state().gates).toEqual([])
      expect(mergeTaskOf(h).status).toBe('dispatched')
    }
    await failMerge(h)
    expect(starts).toHaveLength(3)
    const gates = h.state().gates.filter((g) => g.taskId === mergeTaskOf(h).id)
    expect(gates).toHaveLength(1)
    expect(gates[0].question).toContain('the merge worker failed too')
  })

  it('T1: a hands-off plan retries a failed merge worker with the reason its last attempt reported in its spec', async () => {
    const { h, starts } = mergingRig(conflict, { accountIds: [] }, true)
    await h.loop.nudge()
    await h.settle()
    expect(starts).toHaveLength(1)
    const merge = mergeTaskOf(h)
    const d = h.state().dispatches.find((x) => x.taskId === merge.id && !x.endedAt)!
    await h.as(d.sessionId, 'send', { type: 'worker_done', taskId: merge.id, dispatchId: d.id, outcome: 'failed', subject: 'conflict in plan.md', body: 'plan.md:40 both sides edited the same line' })
    await h.loop.nudge()
    await h.settle()
    expect(starts).toHaveLength(2)
    const retrySpec = h.startWorker.mock.calls[1][0].spec
    expect(retrySpec).toContain('## Previous attempt')
    expect(retrySpec).toContain('conflict in plan.md')
    expect(retrySpec).toContain('plan.md:40 both sides edited the same line')
  })

  it("T1: a hands-off plan sends a merging Task's git problem (kind human) to the merge worker, not the owner", async () => {
    const human = { kind: 'human' as const, reason: 'the plan branch has 2 uncommitted changes', message: { key: 'jobs.integration.uncommitted' as const, params: { count: 2 } } }
    const { h, starts } = mergingRig(human, {}, true)
    await h.loop.nudge()
    await h.settle()
    const merge = mergeTaskOf(h)
    expect(merge.spec).toContain('uncommitted changes')
    expect(starts).toHaveLength(1)
    expect(h.state().gates).toEqual([])
  })

  it('T1: a plan that is not hands-off asks the owner at the first merge-worker failure, and at a kind human result', async () => {
    const { h, starts } = mergingRig(conflict)
    await h.loop.nudge()
    await h.settle()
    await failMerge(h)
    expect(starts).toHaveLength(1)
    expect(h.state().gates.filter((g) => g.taskId === mergeTaskOf(h).id && g.status === 'open')).toHaveLength(1)
    const human = mergingRig({ kind: 'human', reason: 'the plan branch has 2 uncommitted changes', message: { key: 'jobs.integration.uncommitted', params: { count: 2 } } })
    await human.h.loop.nudge()
    await human.h.settle()
    expect(human.starts).toEqual([])
    expect(human.h.state().gates.filter((g) => g.taskId === 'tsk_A')).toHaveLength(1)
  })

  it("a clean wave merge tells the coordinator, once, and the next ready Task", async () => {
    const h = rig()
    driven(h, {
      tasks: [task({ id: 'tsk_1', status: 'completed' }), task({ id: 'tsk_3', deps: ['tsk_1'] })],
      dispatches: [
        { id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'accA', sessionId: 'w-1', cwd: '/wt-child', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' } as Dispatch
      ]
    })
    let n = 0
    h.ctx.integrate = async () => (n++, { kind: 'merged', uncommitted: 0 })
    await h.loop.nudge()
    await h.loop.nudge()
    expect(n).toBe(1)
    const told = h.state().messages.filter((m) => m.subject === 'task tsk_1 merged into the plan')
    expect(told).toHaveLength(1)
    expect(told[0].body).toContain('tsk_3 (tsk_3) is ready and has no worker')
  })

  it('usage resumed tells nothing while this process may not start work', async () => {
    const h = rig({ coordinatorMail: true })
    h.ctx.mayStart = () => false
    await h.loop.usageResumed('accA')
    expect(h.handled()).toEqual([])
  })

  // Review Focus 1, R15.
  it('a retiring Host’s refusal stops the activation and gates nothing', async () => {
    const h = rig({ concurrency: 2 })
    h.ctx.handle = async (cmd) =>
      cmd === 'worker-start'
        ? { status: 409, body: { error: 'the Host is retiring', retry: 'the same command' } }
        : { status: 200, body: {} }
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toEqual(['worker-start']) // not a second slot, and no gate-create
  })

  // R15 through the commit path: the refused start really opened a Dispatch and rolled it back, and
  // both commits re-ran the loop (scheduleAgain). The activation still stops — a `break` out of the
  // slot loop alone would let the next pass ask the leaving Host once more for the other Task.
  it('a retiring Host’s refusal stops the activation even when the refused start committed and rolled back', async () => {
    const h = rig({ concurrency: 2, startFailsFor: 'all' })
    h.ctx.handle = async (cmd, args) => {
      const reply = await h.real(cmd, args)
      return cmd === 'worker-start'
        ? { status: 409, body: { error: 'the Host is retiring', retry: 'the same command' } }
        : reply
    }
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.handled()).toEqual(['worker-start'])
    expect(h.state().tasks.filter((t) => t.status === 'blocked')).toEqual([])
  })

  it('any other failed start gates that one Task and goes on with the next slot', async () => {
    const h = rig({ concurrency: 2, startFailsFor: 0 })
    await h.loop.run()
    await h.settle()
    expect(h.state().tasks.filter((t) => t.status === 'blocked')).toHaveLength(1)
    expect(h.startWorker).toHaveBeenCalledTimes(2)
  })

  // B4: concurrency 1, both Tasks fail and their Gates are refused. The rollbacks commit, the commit
  // re-runs the loop (scheduleAgain), and the attempted set is what keeps each Task to one try.
  //
  // **One start, not two** (the brief said 2). slotsToFill cuts to the Run's room (1) *before* the
  // loop filters by `attempted`, so once tsk_1 is back at ready with its Gate refused it holds the only
  // slot, the filter leaves nothing, and tsk_2 waits for the next state change. That is the moved code
  // unchanged (ipc.ts did the same); what the test pins is that the pass ends instead of spinning —
  // without `attempted` it restarts tsk_1 on every rollback commit, forever.
  it('never retries the same Task twice in one activation (the attempted set)', async () => {
    const h = rig({ startFailsFor: 'all', gateRefused: true })
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1) // once, not a spin
    expect(h.startWorker.mock.calls[0][0].taskId).toBe('tsk_1')
    expect(h.handled()).toEqual(['worker-start', 'gate-create'])
  })

  // T10: a hands-off plan answers each Gate and the Task goes back to ready; the same reason must not open Gates for ever.
  it('blocks a Task once, with no third Gate, when a hands-off plan has answered the same reason twice', async () => {
    const h = rig({ startFailsFor: 'all' })
    h.startWorker.mockRejectedValue(new Error('same reason'))
    const s0 = h.state()
    h.setState({ ...s0, jobs: s0.jobs.map((j) => ({ ...j, handsOff: true })) })
    for (let i = 0; i < 2; i++) {
      await h.loop.run()
      await h.settle()
      const open = h.state().gates.filter((g) => g.taskId === 'tsk_1' && g.status === 'open')
      expect(open).toHaveLength(1)
      expect((await h.real('questions-answer', { id: open[0].id, answer: 'Refused' })).status).toBe(200)
      await h.settle()
    }
    await h.loop.run()
    await h.settle()
    expect(h.state().gates.filter((g) => g.taskId === 'tsk_1')).toHaveLength(2)
    const blocked = h.state().tasks.find((t) => t.id === 'tsk_1')
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.result).toContain('same reason')
  })

  it('keeps opening a Gate for a plan that is not hands-off', async () => {
    const h = rig({ startFailsFor: 'all' })
    h.startWorker.mockRejectedValue(new Error('same reason'))
    for (let i = 0; i < 3; i++) {
      await h.loop.run()
      await h.settle()
      const open = h.state().gates.filter((g) => g.taskId === 'tsk_1' && g.status === 'open')
      expect(open).toHaveLength(1)
      await h.real('questions-answer', { id: open[0].id, answer: 'retry' })
      await h.settle()
    }
    expect(h.state().gates.filter((g) => g.taskId === 'tsk_1').length).toBeGreaterThanOrEqual(3)
  })

  // R14.
  it('does nothing more with a Task once worker-start answered 2xx: a throwing log after it costs nothing', async () => {
    const h = rig()
    h.ctx.log = () => {
      throw new Error('log down')
    }
    await expect(h.loop.run()).resolves.toBeUndefined()
    await h.settle()
    expect(h.handled()).toEqual(['worker-start'])
  })

  // R14, the log itself: the question path logs after its reply, and a gate logs before its command. A
  // log that throws must reach neither the caller nor the Gate — `log` is a notice, not a step.
  it('a throwing log never breaks the loop: the reply still goes out, and run() resolves', async () => {
    const h = rig({ question: true })
    h.ctx.log = () => {
      throw new Error('log down')
    }
    await expect(h.loop.run()).resolves.toBeUndefined()
    await h.settle()
    expect(h.handled()).toContain('reply')
  })

  it('answers an unattended question with NO_COORDINATOR_ANSWER on a Run with no coordinator', async () => {
    const h = rig({ question: true })
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toContain('reply')
  })

  // The incident of 2026-10-13: a session ran the orchestration skill (run-create, worker-start, check --wait), its
  // worker asked, and the loop answered NO_COORDINATOR_ANSWER 9 ms later, before that session could (spec §1).
  describe('a Run its creating session drives from the CLI (spec E3, E4)', () => {
    const driven = async (alive: (id: string) => boolean) => {
      const h = rig()
      h.ctx.sessionAlive = alive
      const made = await h.as('sess-drv', 'run-create', { objective: 'drive it', cwd: '/p' })
      await h.settle()
      const runId = (made.body as { id: string }).id
      const s = h.state()
      const jobId = s.runs.find((r) => r.id === runId)!.jobId
      h.setState({
        ...s,
        tasks: [...s.tasks, task({ id: 'tsk_w', runId, jobId, status: 'dispatched' })],
        dispatches: [
          ...s.dispatches,
          {
            id: 'dsp_w',
            taskId: 'tsk_w',
            provider: 'codex',
            accountId: 'accA',
            sessionId: 'sess-w',
            cwd: '/p',
            specPath: '/specs/w.md',
            startedAt: NOW,
            workerState: 'ready',
            retained: false
          }
        ],
        messages: [...s.messages, message({ id: 'msg_w', runId, type: 'question', taskId: 'tsk_w', dispatchId: 'dsp_w' })]
      })
      await h.loop.run()
      await h.settle()
      return h
    }

    it('leaves the worker’s question to that session while it lives', async () => {
      const h = await driven(() => true)
      expect(h.handled()).not.toContain('reply')
      expect(h.state().messages.find((m) => m.id === 'msg_w')!.answered).toBe(false)
    })

    it('answers it once that session is gone', async () => {
      const h = await driven((id) => id !== 'sess-drv')
      expect(h.handled()).toContain('reply')
    })
  })

  // T5b: no account named is auto, never a Gate
  it('starts a ready Task with no account on a logged-in account instead of gating it', async () => {
    const h = rig({ noAccountTask: true })
    await h.loop.run()
    await h.settle()
    expect(h.handled()).not.toContain('gate-create')
    expect(h.handled()).toContain('worker-start')
  })

  it('fires a due schedule only after one tick has armed it (D2)', async () => {
    const h = rig({ schedule: { every: 'minute' } })
    await h.loop.fireTick()
    expect(h.handled()).not.toContain('run-spawn')
    h.clock += 61_000
    await h.loop.fireTick()
    expect(h.handled()).toContain('run-spawn')
    h.loop.forgetArming()
    h.clock += 61_000
    await h.loop.fireTick()
    expect(h.handled().filter((c) => c === 'run-spawn')).toHaveLength(1)
  })

  // N3: the app arms without firing in front of a driving Host, and the sidebar reads the arming.
  it('armOnly arms a template without firing it, and nextFireOf reads that arming', async () => {
    const h = rig({ schedule: { every: 'minute' } })
    expect(h.loop.nextFireOf(h.templateRunId)).toBeNull()
    h.loop.armOnly()
    const armed = h.loop.nextFireOf(h.templateRunId)
    expect(typeof armed).toBe('number')
    h.clock += 61_000
    h.loop.armOnly()
    expect(h.handled()).not.toContain('run-spawn')
    expect(h.loop.nextFireOf(h.templateRunId)).toBeGreaterThan(armed!)
  })

  it('nudges an idle coordinator with unread upward mail, and never a busy one', async () => {
    const h = rig({ coordinatorMail: true })
    h.ctx.sessionBusy = () => true
    await h.loop.nudge()
    expect(h.typed).toEqual([])
    h.ctx.sessionBusy = () => false
    await h.loop.nudge()
    expect(h.typed[0]).toMatch(/unread message/)
    expect(h.typed[1]).toBe('\r')
  })

  it('forks the Run worktree lazily and records it before the first worker', async () => {
    const h = rig({ runWithoutWorktree: true })
    await h.loop.run()
    await h.settle()
    expect(h.forked).toHaveLength(1)
    expect(h.handled().slice(0, 2)).toEqual(['run-worktree-set', 'worker-start'])
  })

  it("forks the Run worktree from the plan's target branch when it has one", async () => {
    const h = rig({ runWithoutWorktree: true })
    h.setState({ ...h.state(), jobs: h.state().jobs.map((j) => ({ ...j, deliveryBranch: 'release' })) })
    await h.loop.run()
    await h.settle()
    expect(h.forked).toHaveLength(1)
    expect(h.forked[0].base).toBe('release')
  })

  // Review m3: the re-read after run-worktree-set is what puts the first worker in the new Run worktree.
  // A stale `run` has no worktree, so runRootOf answers the project folder (/p).
  it('starts the first worker of a lazily forked Run in the Run worktree, not the project folder', async () => {
    const h = rig({ runWithoutWorktree: true })
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    expect(h.startWorker.mock.calls[0][0].worktree).toBe('/wt-forked')
  })

  // Review m2: the `finally` that clears the re-entrancy flag. A pass that throws must not leave the
  // loop believing it is still running, or no later pass would ever run.
  it('a pass that throws does not block every later pass (the finally)', async () => {
    const h = rig()
    const accounts = h.ctx.accounts
    h.ctx.accounts = () => {
      throw new Error('accounts unreadable')
    }
    await expect(h.loop.run()).rejects.toThrow('accounts unreadable')
    expect(h.startWorker).not.toHaveBeenCalled()
    h.ctx.accounts = accounts
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
  })

  // Review m4: the arming is replaced before the run-spawn awaits. A second tick that starts while the
  // first tick's run-spawn is still open must see the new arming and fire nothing.
  it('two overlapping ticks fire a due template once (the arming is replaced before the awaits)', async () => {
    const h = rig({ schedule: { every: 'minute' } })
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-spawn') return h.real(cmd, args)
      await held
      return { status: 200, body: {} }
    }
    await h.loop.fireTick() // arms only
    h.clock += 61_000
    const first = h.loop.fireTick() // fires, and waits on run-spawn
    const second = h.loop.fireTick() // overlaps it
    release()
    await Promise.all([first, second])
    expect(h.handled().filter((c) => c === 'run-spawn')).toHaveLength(1)
  })

  // Review m1: the same as the attempted-set test above, with room for both Tasks — once per Task.
  it('never retries the same Task twice in one activation, with room for both Tasks', async () => {
    const h = rig({ concurrency: 2, startFailsFor: 'all', gateRefused: true })
    await h.loop.run()
    await h.settle()
    expect(h.startWorker.mock.calls.map((c) => c[0].taskId)).toEqual(['tsk_1', 'tsk_2'])
  })

  // The fixture reaches the reap: a finished scheduled child Run's worktree is removed after the pass.
  it('removes a finished scheduled child Run’s worktree after the pass', async () => {
    const h = rig({ reapableChild: true })
    await h.loop.run()
    await h.settle()
    expect(h.reaped).toEqual(['/wt-child'])
  })

  // Audit OR-4: a worktree Windows keeps locked failed its reap on every pass (a kill, a 5 s poll, a failed git
  // remove), for as long as the app ran. It is tried again after a growing wait, and given up on in the end.
  it('a worktree that could not be removed is tried again after a growing wait, then given up', async () => {
    const h = rig({ reapableChild: true, reapFails: true })
    const pass = async (): Promise<void> => {
      await h.loop.run()
      await h.settle()
    }
    await pass()
    await pass()
    expect(h.reaped).toEqual(['/wt-child'])
    h.clock += COORDINATOR_STOP_RETRY_MS
    await pass()
    expect(h.reaped).toHaveLength(2)
    for (let i = 0; i < 40; i++) {
      h.clock += COORDINATOR_STOP_RETRY_MAX_MS
      await pass()
    }
    const tried = h.reaped.length
    h.clock += COORDINATOR_STOP_RETRY_MAX_MS
    await pass()
    expect(h.reaped).toHaveLength(tried)
    expect(h.logs.filter((l) => l.includes('gave up removing'))).toHaveLength(1)
    // Final review I2: giving up was for good, though a held worker released or a folder closed later lets it go. It is
    // tried again quietly every hour.
    h.clock += 60 * 60_000
    await pass()
    expect(h.reaped).toHaveLength(tried + 1)
    expect(h.logs.filter((l) => l.includes('gave up removing'))).toHaveLength(1)
  })

  // Final review I1: each candidate was checked again on the current state before the cheap "is its session alive",
  // and that check swept the whole history again: a month of finished Runs cost Dispatches squared per commit.
  it('a month of finished Runs whose workers are gone is passed over quickly', async () => {
    const h = rig({ deadSessions: true })
    const s = h.state()
    const runs = Array.from({ length: 300 }, (_, i) => ({ id: `run_old${i}`, jobId: s.runs[0].jobId, ordinal: i + 2, createdAt: NOW }))
    const tasks = runs.flatMap((r) => Array.from({ length: 5 }, (_, j) => ({ ...s.tasks[0], id: `${r.id}_t${j}`, runId: r.id, status: 'completed' as const })))
    const dispatches = tasks.map((t, i) => ({ id: `dsp_old${i}`, taskId: t.id, sessionId: `sess_old${i}`, provider: 'claude' as const, accountId: 'accA', cwd: '/w', specPath: '/s', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' as const, workerState: 'stopped' as const, retained: false }))
    h.setState({ ...s, runs: [...s.runs, ...runs], tasks: [...s.tasks, ...tasks], dispatches: [...s.dispatches, ...dispatches] } as OrchState)
    h.clock = NOW_MS + 60 * 60_000
    const t0 = performance.now()
    await h.loop.run()
    await h.settle()
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  // Review m5: a process that stopped driving mid-pass does not go on to the reap — the new driver's
  // first pass reaps, and two processes must not remove the same worktree at once.
  it('a driver that changes mid-pass does not reap', async () => {
    const h = rig({ concurrency: 2, reapableChild: true })
    // The start answers 2xx without committing, so nothing sets scheduleAgain: the pass ends on the
    // per-slot break itself, not on the next pass's entry check — the case where the reap would still run.
    h.ctx.handle = async (cmd, args) => (cmd === 'worker-start' ? { status: 200, body: {} } : h.real(cmd, args))
    let allowed = 2 // the entry check, then the first slot
    h.ctx.mayStart = () => allowed-- > 0
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toEqual(['worker-start'])
    expect(h.reaped).toEqual([])
  })
})

// F65 and U1: a schedule firing behaves exactly like `jobs run` of that Job. The template here has no
// `autoDispatch` and no `pendingStart`, the shape every scheduled Job on disk has (R2): nothing is
// migrated, the fire decides from `schedule` and `coordinatorAccountId`.
describe('a fired Run starts the way `jobs run` starts one (U1)', () => {
  /** Arms the template, then fires it once, and lets the commits it causes run their passes. */
  const fireOnce = async (h: ReturnType<typeof rig>): Promise<string> => {
    await h.loop.fireTick()
    h.clock += 61_000
    await h.loop.fireTick()
    await h.settle()
    await h.settle()
    const child = h.state().runs.find((r) => r.jobId === TEMPLATE_ID)
    if (!child) throw new Error('the fire made no run')
    return child.id
  }

  it('with no coordinator account, the fired Run is placed by the next pass', async () => {
    const h = rig({ schedule: { every: 'minute' }, scheduleTask: true })
    const childId = await fireOnce(h)
    const copied = h.state().tasks.find((t) => t.runId === childId)!
    expect(copied.status).toBe('dispatched')
    expect(h.startWorker.mock.calls.map((c) => c[0].taskId)).toContain(copied.id)
    expect(h.startCoordinator).not.toHaveBeenCalled()
  })

  it('with a coordinator account, the fire starts that Run’s own coordinator and the loop leaves it alone', async () => {
    const h = rig({ schedule: { every: 'minute' }, scheduleTask: true, scheduleCoordinator: 'accA' })
    const childId = await fireOnce(h)
    expect(h.startCoordinator).toHaveBeenCalledTimes(1)
    expect(h.startCoordinator.mock.calls[0][0]).toMatchObject({ runId: childId, accountId: 'accA' })
    expect(h.state().runs.find((r) => r.id === childId)?.coordinatorSessionId).toBe(`coord-${childId}`)
    // One driver per Run: the coordinator places this Run's Tasks, not the loop.
    const copied = h.state().tasks.find((t) => t.runId === childId)!
    expect(copied.status).toBe('ready')
    expect(h.startWorker.mock.calls.map((c) => c[0].taskId)).not.toContain(copied.id)
  })
})

// User ruling 2026-09-25 on Task 1's concern 2: a fire behaves like `jobs run` here too. While the
// latest Run of the Job still runs (`limited` counts), the fire is skipped and consumed.
describe('a fire while the Job’s latest Run still runs', () => {
  const runsOf = (h: ReturnType<typeof rig>) => h.state().runs.filter((r) => r.jobId === TEMPLATE_ID)
  const skips = (h: ReturnType<typeof rig>) => h.logs.filter((m) => /scheduled fire skipped/.test(m))

  it('is skipped: no Run, one log line, and not retried on a later tick of the same fire time', async () => {
    const h = rig({ schedule: { every: 'minute' }, scheduleTask: true })
    await h.loop.fireTick() // arms
    h.clock += 61_000
    await h.loop.fireTick() // fires the first Run, which the pass places: it runs
    await h.settle()
    expect(runsOf(h)).toHaveLength(1)
    h.clock += 61_000
    await h.loop.fireTick() // due again while the first still runs
    await h.settle()
    expect(runsOf(h)).toHaveLength(1)
    expect(skips(h)).toHaveLength(1)
    expect(skips(h)[0]).toContain(runsOf(h)[0].id)
    h.clock += 15_000 // the next tick, same fire time: consumed, nothing to retry
    await h.loop.fireTick()
    expect(skips(h)).toHaveLength(1)
    expect(h.handled().filter((c) => c === 'run-spawn')).toHaveLength(2)
  })

  it('fires again at the next fire time once that Run has ended', async () => {
    const h = rig({ schedule: { every: 'minute' }, scheduleTask: true })
    await h.loop.fireTick()
    h.clock += 61_000
    await h.loop.fireTick()
    await h.settle()
    h.clock += 61_000
    await h.loop.fireTick() // skipped
    await h.settle()
    // The first Run ends: its one Task completes and its worker is gone.
    const first = runsOf(h)[0]
    const s = h.state()
    const done = s.tasks.map((t) => (t.runId === first.id ? { ...t, status: 'completed' as const } : t))
    const closed = s.dispatches.map((d) =>
      done.some((t) => t.id === d.taskId && t.runId === first.id) ? { ...d, outcome: 'succeeded' as const, endedAt: new Date(h.clock).toISOString() } : d
    )
    h.setState({ ...s, tasks: done, dispatches: closed })
    h.clock += 61_000
    await h.loop.fireTick()
    await h.settle()
    expect(runsOf(h)).toHaveLength(2)
    expect(skips(h)).toHaveLength(1)
  })
})

// Task 1 fix round 1, M1: the drive can move between two fires of one tick.
describe('orchFireTick asks mayStart between fires', () => {
  it('fires no further template once the drive has moved', async () => {
    const h = rig({ schedule: { every: 'minute' } })
    const s = h.state()
    const second = { ...s.jobs.find((j) => j.id === TEMPLATE_ID)!, id: 'job_sched2' }
    h.setState({ ...s, jobs: [...s.jobs, second] })
    await h.loop.fireTick() // arms both
    h.clock += 61_000
    let allowed = true
    const handle = h.ctx.handle
    h.ctx.handle = async (cmd, args) => {
      const r = await handle(cmd, args)
      if (cmd === 'run-spawn') allowed = false // the drive moves after the first fire
      return r
    }
    h.ctx.mayStart = () => allowed
    await h.loop.fireTick()
    expect(h.handled().filter((c) => c === 'run-spawn')).toHaveLength(1)
  })
})

// The user's U4 (2026-09-25): a scheduled Job's Run that has finished gets its coordinator stopped, by
// the process that drives only. A manual `jobs run` Run keeps its coordinator (the controller's ruling
// on U4's scope): a person may be reading its tab.
describe('a finished scheduled Run’s coordinator is stopped (U4)', () => {
  const withCoordinator = (h: ReturnType<typeof rig>, runId: string, sessionId: string): void => {
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, coordinatorSessionId: sessionId } : r)) })
  }
  const finish = (h: ReturnType<typeof rig>, runId: string): void => {
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t)) })
  }

  it('stops it through run-coordinator-stop, keeps the slot pending (L1), and does not ask again at once', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-rc', 'the run has nothing left for it to do', 'stopped']])
    expect(h.handled()).toContain('run-coordinator-stop')
    expect(h.state().runs.find((r) => r.id === 'run_rc')?.coordinatorStopPending).toBeDefined()
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
  })

  it('leaves a manual Run’s coordinator alone while a person’s follow-up grace runs', async () => {
    const h = rig()
    withCoordinator(h, 'run_1', 'coord-1')
    finish(h, 'run_1')
    h.ctx.lastPersonInputAt = () => NOW_MS + 1
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
    expect(h.state().runs.find((r) => r.id === 'run_1')?.coordinatorSessionId).toBe('coord-1')
  })

  it('leaves a scheduled Run that has not finished alone', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => (t.id === 'tsk_rc' ? { ...t, status: 'ready' as const } : t)) })
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
  })

  it('only the driving process stops it: the loop that may not start stops nothing', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    // The other process: same state, same command layer, but it does not drive.
    const other = createDispatchLoop({ ...h.ctx, mayStart: () => false })
    await other.run()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
    await Promise.all([h.loop.run(), other.run()])
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
  })

  it('a refused or failed stop is logged, never thrown, and not sent again before its backoff', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-coordinator-stop') throw new Error('socket closed')
      return h.real(cmd, args)
    }
    await expect(h.loop.run()).resolves.toBeUndefined()
    await h.loop.run()
    expect(h.handled().filter((c) => c === 'run-coordinator-stop')).toHaveLength(1)
    expect(h.logs.join('\n')).toContain('socket closed')
  })
})

// Mutation M3a: the drive can move between two stops of one pass; the loop asks before each one.
describe('stopFinishedCoordinators asks mayStart before each stop', () => {
  it('stops no further coordinator once the drive has moved', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({
      ...s,
      jobs: [...s.jobs, { id: 'job_rc2', objective: 'scheduled', cwd: '/p', createdAt: NOW, schedule: { kind: 'interval', minutes: 60 } }],
      runs: [
        ...s.runs.map((r) => (r.id === 'run_rc' ? { ...r, coordinatorSessionId: 'coord-rc' } : r)),
        { id: 'run_rc2', jobId: 'job_rc2', ordinal: 1, createdAt: NOW, coordinatorSessionId: 'coord-rc2' }
      ],
      tasks: [...s.tasks, { ...s.tasks.find((t) => t.id === 'tsk_rc')!, id: 'tsk_rc2', runId: 'run_rc2', jobId: 'job_rc2' }]
    })
    let allowed = true
    h.ctx.handle = async (cmd, args) => {
      const r = await h.real(cmd, args)
      if (cmd === 'run-coordinator-stop') allowed = false // the drive moves after the first stop
      return r
    }
    h.ctx.mayStart = () => allowed
    await h.loop.run()
    expect(h.handled().filter((c) => c === 'run-coordinator-stop')).toHaveLength(1)
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
  })
})

// The user's decision of 2026-10-02 (e2e "Fourth run"): a manual Run that has finished kept its
// coordinator alive for good, so `host stop` refused and an MCP client had nothing to end it with. Its
// coordinator now stops as soon as the Run's completion check has settled; only a person typing into it
// after the finish holds it for FINISHED_RUN_GRACE_MS from that input (2026-10-25).
describe('a finished manual Run’s coordinator stops after the grace', () => {
  const MIN = 60_000
  // A person typed into the session 1 ms after the Run finished: the follow-up grace counts from here.
  const TYPED = NOW_MS + 1
  const finishedWithCoordinator = () => {
    const h = rig()
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map((r) => (r.id === 'run_1' ? { ...r, coordinatorSessionId: 'coord-1' } : r)),
      tasks: s.tasks.map((t) => (t.runId === 'run_1' ? { ...t, status: 'completed' as const } : t))
    })
    return h
  }
  const pass = async (h: ReturnType<typeof rig>): Promise<void> => {
    await h.loop.run()
    await h.settle()
  }
  const stops = (h: ReturnType<typeof rig>): number => h.handled().filter((c) => c === 'run-coordinator-stop').length

  it('is 10 minutes', () => {
    expect(FINISHED_RUN_GRACE_MS).toBe(10 * MIN)
  })

  it('stops it on the first pass after the finish when nobody typed into it, busy or not', async () => {
    const h = finishedWithCoordinator()
    h.ctx.sessionBusy = () => true
    h.clock = NOW_MS
    await pass(h)
    expect(stops(h)).toBe(1)
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-1', 'the run has nothing left for it to do', 'stopped']])
  })

  it('after a person’s follow-up, leaves it alone 9 minutes, and sends the stop once at 10', async () => {
    const h = finishedWithCoordinator()
    h.ctx.lastPersonInputAt = () => TYPED
    h.clock = TYPED + 9 * MIN
    await pass(h)
    expect(stops(h)).toBe(0)
    h.clock = TYPED + 10 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-1', 'the run has nothing left for it to do', 'stopped']])
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  it('the timer tick sends it too, with nothing committed', async () => {
    const h = finishedWithCoordinator()
    h.clock = NOW_MS
    await h.loop.nudge()
    await h.settle()
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-1', 'the run has nothing left for it to do', 'stopped']])
  })

  it('a person typing into it at minute 8 moves the stop to minute 18', async () => {
    const h = finishedWithCoordinator()
    h.ctx.lastPersonInputAt = (id) => (id === 'coord-1' ? NOW_MS + 8 * MIN : null)
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    h.clock = NOW_MS + 18 * MIN - 1
    await pass(h)
    expect(stops(h)).toBe(0)
    h.clock = NOW_MS + 18 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  it('input before the finish counts for nothing: the finish is the later of the two', async () => {
    const h = finishedWithCoordinator()
    h.ctx.lastPersonInputAt = () => NOW_MS - 5 * MIN
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  it('the loop’s own nudge into it is not a person’s input', async () => {
    const h = finishedWithCoordinator()
    // An unread report from long ago: the loop types a nudge into the coordinator on its tick.
    const s = h.state()
    h.setState({ ...s, messages: [message({ id: 'msg_up', type: 'status', createdAt: new Date(NOW_MS - 120_000).toISOString() })] })
    h.clock = NOW_MS + 5 * MIN
    await h.loop.nudge()
    await h.settle()
    expect(h.typed.length).toBeGreaterThan(0)
    // counted as a person's input it would hold the stop for 10 more minutes
    expect(stops(h)).toBe(1)
  })

  it('leaves the coordinator of a Run that has not finished alone, however long', async () => {
    const h = rig()
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === 'run_1' ? { ...r, coordinatorSessionId: 'coord-1' } : r)) })
    // No slot to fill: both Tasks wait, and the Run is still running.
    h.setState({ ...h.state(), tasks: h.state().tasks.map((t) => ({ ...t, status: 'pending' as const })) })
    h.clock = NOW_MS + 60 * MIN
    await pass(h)
    expect(stops(h)).toBe(0)
  })

  // Fix round 1: the grace counts from the last input, so a coordinator still answering a follow-up
  // past it was stopped mid-turn (run-coordinator-stop does not ask a finished Run's idle state).
  it('a coordinator busy at minute 11 is not stopped; once idle it is', async () => {
    const h = finishedWithCoordinator()
    let busy: boolean | null = true
    h.ctx.lastPersonInputAt = () => TYPED
    h.ctx.sessionBusy = (id) => (id === 'coord-1' ? busy : false)
    h.clock = NOW_MS + 11 * MIN
    await pass(h)
    expect(stops(h)).toBe(0)
    busy = false
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  // Controller ruling: the busy veto is bounded. The busy state is a title spinner that never ages out,
  // so a session hung with it up was never cleaned.
  it('a coordinator busy at grace + 59 min is left alone; at grace + 60 min it is stopped', async () => {
    const h = finishedWithCoordinator()
    h.ctx.lastPersonInputAt = () => TYPED
    h.ctx.sessionBusy = () => true
    expect(FINISHED_RUN_BUSY_CAP_MS).toBe(60 * MIN)
    h.clock = TYPED + FINISHED_RUN_GRACE_MS + 59 * MIN
    await pass(h)
    expect(stops(h)).toBe(0)
    h.clock = TYPED + FINISHED_RUN_GRACE_MS + 60 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  it('a coordinator whose busy state is unknown falls back to the time rule', async () => {
    const h = finishedWithCoordinator()
    h.ctx.sessionBusy = () => null
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
  })

  it('a scheduled finished Run’s coordinator is stopped at once, busy or not', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === 'run_rc' ? { ...r, coordinatorSessionId: 'coord-rc' } : r)) })
    h.ctx.sessionBusy = () => true
    await pass(h)
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-rc', 'the run has nothing left for it to do', 'stopped']])
  })

  // The re-check in run-coordinator-stop (runMoves): a stop still pending for a Run that has work again
  // is refused, its mark dropped, and the coordinator kept.
  it('a Run reopened while its coordinator stop is pending keeps its coordinator', async () => {
    const h = finishedWithCoordinator()
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(stops(h)).toBe(1)
    const run1 = () => h.state().runs.find((r) => r.id === 'run_1')!
    expect(run1().coordinatorStopPending).toBeDefined()
    // A new Task the coordinator can start: the Run is running again.
    const s = h.state()
    h.setState({ ...s, tasks: [...s.tasks, task({ id: 'tsk_3', status: 'pending' })] })
    h.clock += COORDINATOR_STOP_RETRY_MS
    await pass(h)
    expect(stops(h)).toBe(2)
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
    expect(run1().coordinatorSessionId).toBe('coord-1')
    expect(run1().coordinatorStopPending).toBeUndefined()
    h.clock += COORDINATOR_STOP_RETRY_MAX_MS
    await pass(h)
    expect(stops(h)).toBe(2)
  })

  it('only the driving process stops it', async () => {
    const h = finishedWithCoordinator()
    h.clock = NOW_MS + 10 * MIN
    const other = createDispatchLoop({ ...h.ctx, mayStart: () => false })
    await other.run()
    await other.nudge()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
  })
})

// The same decision, for the workers (e2e "Fourth run": the converged Run's worker stayed alive too).
// A worker reports and then waits, by the guide's rule, and only `worker-release` ends its session;
// that is the coordinator's to send, and once the Run has finished nothing sent it. Now the driving loop
// sends it for an idle worker (its Dispatch closed, not retained) of a finished Run, under the same grace.
// Audit OR-1: the release pass walked every Dispatch for every finished Run, and for each pair filtered the Tasks and the
// Dispatches again — on every commit and every tick, over 30 days of Runs. It is one pass with its indexes built once.
describe('idleWorkersOf', () => {
  const task = (id: string, runId: string, status: Task['status']): Task => ({ id, runId, title: id, spec: '', deps: [], status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW }) as Task
  const disp = (id: string, taskId: string, sessionId: string, over: Partial<Dispatch> = {}): Dispatch =>
    ({ id, taskId, sessionId, provider: 'claude', accountId: 'a', cwd: '/w', specPath: '/s', startedAt: NOW, endedAt: NOW, outcome: 'succeeded', workerState: 'stopped', retained: false, ...over }) as Dispatch
  const base = (runs: string[]): OrchState => ({ ...emptyState(), runs: runs.map((id) => ({ id, jobId: 'job_1', ordinal: 1, createdAt: NOW })) }) as OrchState
  it('names the closed, unretained, latest Dispatch of each session of a finished Run, and nothing else', () => {
    const s: OrchState = {
      ...base(['run_done', 'run_live']),
      tasks: [task('t1', 'run_done', 'completed'), task('t2', 'run_done', 'completed'), task('t3', 'run_live', 'dispatched')],
      dispatches: [
        disp('d_old', 't1', 'sess_reused'),
        disp('d_new', 't2', 'sess_reused'),
        disp('d_kept', 't1', 'sess_kept', { retained: true }),
        disp('d_open', 't2', 'sess_open', { outcome: undefined, endedAt: undefined }),
        disp('d_live', 't3', 'sess_live')
      ]
    }
    expect(idleWorkersOf(s).map((x) => `${x.runId}:${x.dispatch.id}`)).toEqual(['run_done:d_new'])
  })
  it('is one pass: a month of history is read in well under a second', () => {
    const runs = Array.from({ length: 200 }, (_, i) => `run_${i}`)
    const tasks = runs.flatMap((r) => Array.from({ length: 5 }, (_, j) => task(`${r}_t${j}`, r, 'completed')))
    const dispatches = tasks.flatMap((t, i) => [disp(`d${i}a`, t.id, `sess_${i}`), disp(`d${i}b`, t.id, `sess_${i}`)])
    const s: OrchState = { ...base(runs), tasks, dispatches }
    const t0 = performance.now()
    expect(idleWorkersOf(s)).toHaveLength(tasks.length)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('a finished Run’s idle workers are released after the grace', () => {
  const MIN = 60_000
  // A person typed into the worker's session 1 ms after the Run finished: the follow-up grace counts from here.
  const TYPED = NOW_MS + 1
  const dispatch = (over: Partial<Dispatch> & { id: string; taskId: string; sessionId: string }): Dispatch => ({
    provider: 'claude' as const,
    accountId: 'accA',
    cwd: '/wt1',
    specPath: '/specs/x.md',
    startedAt: NOW,
    endedAt: NOW,
    outcome: 'succeeded' as const,
    workerState: 'stopped' as const,
    retained: false,
    ...over
  })
  const finishedWithWorker = (over: Partial<OrchState['dispatches'][number]> = {}, o: RigOpts = {}) => {
    const h = rig(o)
    const s = h.state()
    h.setState({
      ...s,
      tasks: s.tasks.map((t) => (t.runId === 'run_1' ? { ...t, status: 'completed' as const } : t)),
      dispatches: [dispatch({ id: 'dsp_1', taskId: 'tsk_1', sessionId: 'sess_w1', ...over })]
    })
    return h
  }
  const pass = async (h: ReturnType<typeof rig>): Promise<void> => {
    await h.loop.run()
    await h.settle()
  }
  const releases = (h: ReturnType<typeof rig>): string[] => h.releaseWorker.mock.calls.map(([a]) => a.dispatchId)

  it('releases it on the first pass after the finish when nobody typed into it, busy or not', async () => {
    const h = finishedWithWorker()
    h.ctx.sessionBusy = () => true
    h.clock = NOW_MS
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('after a person’s follow-up, leaves it alone 9 minutes, and releases it once at 10', async () => {
    const h = finishedWithWorker()
    h.ctx.lastPersonInputAt = () => TYPED
    h.clock = TYPED + 9 * MIN
    await pass(h)
    expect(releases(h)).toEqual([])
    h.clock = TYPED + 10 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
    expect(h.handled()).toContain('worker-release')
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('does not change the Dispatch: the release only ends the session', async () => {
    const h = finishedWithWorker()
    const before = h.state().dispatches
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(h.state().dispatches).toEqual(before)
  })

  it('a release whose session lives on is sent again after the backoff', async () => {
    const h = finishedWithWorker()
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    h.clock += COORDINATOR_STOP_RETRY_MS - 1
    await pass(h)
    expect(releases(h)).toHaveLength(1)
    h.clock += 1
    await pass(h)
    expect(releases(h)).toHaveLength(2)
  })

  it('a person typing into it at minute 8 moves the release to minute 18', async () => {
    const h = finishedWithWorker()
    h.ctx.lastPersonInputAt = (id) => (id === 'sess_w1' ? NOW_MS + 8 * MIN : null)
    h.clock = NOW_MS + 18 * MIN - 1
    await pass(h)
    expect(releases(h)).toEqual([])
    h.clock = NOW_MS + 18 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('never ends a retained worker', async () => {
    const h = finishedWithWorker({ retained: true })
    h.clock = NOW_MS + 60 * MIN
    await pass(h)
    expect(h.handled()).not.toContain('worker-release')
  })

  it('leaves a worker whose session has already ended', async () => {
    const h = finishedWithWorker()
    h.ctx.sessionAlive = () => false
    h.clock = NOW_MS + 60 * MIN
    await pass(h)
    expect(h.handled()).not.toContain('worker-release')
  })

  it('leaves a session a later Dispatch reuses: the release is the latest owner’s', async () => {
    const h = finishedWithWorker()
    const s = h.state()
    h.setState({
      ...s,
      jobs: [...s.jobs, { id: 'job_2', objective: 'o', cwd: '/p', createdAt: NOW }],
      runs: [...s.runs, { id: 'run_2', jobId: 'job_2', ordinal: 1, createdAt: NOW }],
      tasks: [...s.tasks, task({ id: 'tsk_9', runId: 'run_2', jobId: 'job_2', status: 'completed' })],
      dispatches: [...s.dispatches, dispatch({ id: 'dsp_9', taskId: 'tsk_9', sessionId: 'sess_w1', retained: true })]
    })
    h.clock = NOW_MS + 60 * MIN
    await pass(h)
    expect(h.handled()).not.toContain('worker-release')
  })

  // 2026-10-19: a running Run's worker whose Task is completed is released at once, merged or not (coordinatorRotate.test.ts)
  it('releases the unmerged completed worker of a Run that has not finished', async () => {
    const h = finishedWithWorker({ cwd: '/wt-own' })
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => (t.id === 'tsk_2' ? { ...t, status: 'pending' as const } : t)) })
    h.clock = NOW_MS + 60 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('releases a finished scheduled Run’s worker at once', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({ ...s, dispatches: [dispatch({ id: 'dsp_rc', taskId: 'tsk_rc', sessionId: 'sess_rc', cwd: '/wt-child' })] })
    await pass(h)
    expect(releases(h)).toEqual(['dsp_rc'])
  })

  it('a worker busy at minute 11 is not released; once idle it is', async () => {
    const h = finishedWithWorker()
    let busy: boolean | null = true
    h.ctx.lastPersonInputAt = () => TYPED
    h.ctx.sessionBusy = (id) => (id === 'sess_w1' ? busy : false)
    h.clock = NOW_MS + 11 * MIN
    await pass(h)
    expect(releases(h)).toEqual([])
    busy = null // unknown: the time rule decides
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('a worker busy at grace + 59 min is left alone; at grace + 60 min it is released', async () => {
    const h = finishedWithWorker()
    h.ctx.lastPersonInputAt = () => TYPED
    h.ctx.sessionBusy = () => true
    h.clock = TYPED + FINISHED_RUN_GRACE_MS + 59 * MIN
    await pass(h)
    expect(releases(h)).toEqual([])
    h.clock = TYPED + FINISHED_RUN_GRACE_MS + 60 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('a scheduled finished Run’s worker is released at once, busy or not', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({ ...s, dispatches: [dispatch({ id: 'dsp_rc', taskId: 'tsk_rc', sessionId: 'sess_rc', cwd: '/wt-child' })] })
    h.ctx.sessionBusy = () => true
    await pass(h)
    expect(releases(h)).toEqual(['dsp_rc'])
  })

  // Fix round 1: the pass reads the state once, and each release awaits; a Run reopened meanwhile (or a
  // worker retained) must not lose its worker to the snapshot.
  it('re-reads the state before each release: a Run reopened after the first is left alone', async () => {
    const h = finishedWithWorker()
    const s = h.state()
    h.setState({ ...s, dispatches: [...s.dispatches, dispatch({ id: 'dsp_2', taskId: 'tsk_2', sessionId: 'sess_w2' })] })
    h.ctx.handle = async (cmd, args) => {
      const r = await h.real(cmd, args)
      if (cmd === 'worker-release') {
        const now = h.state()
        h.setState({ ...now, tasks: now.tasks.map((t) => (t.id === 'tsk_2' ? { ...t, status: 'pending' as const } : t)) })
      }
      return r
    }
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('re-reads the state before each release: a worker retained after the snapshot is kept', async () => {
    const h = finishedWithWorker()
    const s = h.state()
    h.setState({ ...s, dispatches: [...s.dispatches, dispatch({ id: 'dsp_2', taskId: 'tsk_2', sessionId: 'sess_w2' })] })
    h.ctx.handle = async (cmd, args) => {
      const r = await h.real(cmd, args)
      if (cmd === 'worker-release') {
        const now = h.state()
        h.setState({ ...now, dispatches: now.dispatches.map((d) => (d.id === 'dsp_2' ? { ...d, retained: true } : d)) })
      }
      return r
    }
    h.clock = NOW_MS + 10 * MIN
    await pass(h)
    expect(releases(h)).toEqual(['dsp_1'])
  })

  it('only the driving process releases it', async () => {
    const h = finishedWithWorker()
    h.clock = NOW_MS + 10 * MIN
    const other = createDispatchLoop({ ...h.ctx, mayStart: () => false })
    await other.run()
    await other.nudge()
    expect(h.releaseWorker).not.toHaveBeenCalled()
  })
})

// Limits pass L1: a coordinator stop is confirmed only when the session is gone (the exit release empties
// the slot). Until then the Run keeps its slot, marked `coordinatorStopPending`, and the driving loop
// sends the stop again after a backoff, so a stop that failed or was refused is not remembered as done.
describe('a coordinator stop is retried until the session is gone (L1)', () => {
  const withCoordinator = (h: ReturnType<typeof rig>, runId: string, sessionId: string): void => {
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, coordinatorSessionId: sessionId } : r)) })
  }
  const rc = (h: ReturnType<typeof rig>) => h.state().runs.find((r) => r.id === 'run_rc')!
  const stops = (h: ReturnType<typeof rig>): number => h.handled().filter((c) => c === 'run-coordinator-stop').length

  it('a failed stop is sent again after its backoff, and then succeeds', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    let fail = true
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-coordinator-stop' && fail) throw new Error('socket closed')
      return h.real(cmd, args)
    }
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(1)
    // Not on every pass: the backoff holds it.
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(1)
    fail = false
    h.clock += COORDINATOR_STOP_RETRY_MS
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(2)
    expect(h.stopCoordinator.mock.calls).toEqual([['coord-rc', 'the run has nothing left for it to do', 'stopped']])
    expect(rc(h).coordinatorStopPending).toBeDefined()
  })

  it('a refused stop is sent again after its backoff too', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    let refuse = true
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-coordinator-stop' && refuse) return { status: 409, body: { error: 'busy' } }
      return h.real(cmd, args)
    }
    await h.loop.run()
    await h.settle()
    refuse = false
    h.clock += COORDINATOR_STOP_RETRY_MS
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(2)
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
  })

  it('keeps the slot, marked pending, while the session lives, and asks again after the backoff', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(1)
    expect(rc(h).coordinatorSessionId).toBe('coord-rc')
    expect(rc(h).coordinatorStopPending).toBeDefined()
    h.clock += COORDINATOR_STOP_RETRY_MS
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(2)
  })

  it('a stop refused at the 10 minute cap N times is logged once as given up and sent no more (LP-1/2)', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-coordinator-stop' && args.gone === undefined) return { status: 409, body: { error: 'run moves' } }
      return h.real(cmd, args)
    }
    const pass = async (): Promise<void> => {
      await h.loop.run()
      await h.settle()
    }
    // Climb to the cap: 30 s, 60 s, ... until the wait reaches COORDINATOR_STOP_RETRY_MAX_MS.
    await pass()
    let wait = COORDINATOR_STOP_RETRY_MS
    let sent = 1
    while (wait < COORDINATOR_STOP_RETRY_MAX_MS) {
      h.clock += wait
      await pass()
      sent++
      wait = Math.min(wait * 2, COORDINATOR_STOP_RETRY_MAX_MS)
    }
    // `sent` stops have been sent and the last one waits the cap. N-1 more at the cap, then it gives up.
    for (let i = 1; i < COORDINATOR_STOP_RETRY_CAP_TRIES; i++) {
      h.clock += COORDINATOR_STOP_RETRY_MAX_MS
      await pass()
      sent++
    }
    expect(stops(h)).toBe(sent)
    const gaveUp = (): string[] => h.logs.filter((m) => /gave up/.test(m))
    expect(gaveUp()).toEqual([])
    for (let i = 0; i < 5; i++) {
      h.clock += COORDINATOR_STOP_RETRY_MAX_MS
      await pass()
    }
    expect(stops(h)).toBe(sent)
    expect(gaveUp()).toHaveLength(1)
    expect(gaveUp()[0]).toContain('coord-rc')
    // The slot stays: a new driver, or a restart, asks again.
    expect(rc(h).coordinatorSessionId).toBe('coord-rc')
  })

  it('a stop given up on still releases the slot once the session is known to be gone (LP-1/2)', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    let gone = false
    h.ctx.sessionGone = () => gone
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-coordinator-stop' && args.gone === undefined) return { status: 409, body: { error: 'run moves' } }
      return h.real(cmd, args)
    }
    for (let i = 0; i < 40; i++) {
      await h.loop.run()
      await h.settle()
      h.clock += COORDINATOR_STOP_RETRY_MAX_MS
    }
    expect(h.logs.filter((m) => /gave up/.test(m))).toHaveLength(1)
    gone = true
    await h.loop.run()
    await h.settle()
    expect(rc(h).coordinatorSessionId).toBeUndefined()
  })

  it('the exit release empties the slot and drops the pending mark, and nothing is sent after it', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    await h.loop.run()
    await h.settle()
    const released = coordinatorReleaseOf(h.state(), 'coord-rc', 0)
    expect(released).not.toBeNull()
    h.setState(released!.state)
    expect(rc(h)).not.toHaveProperty('coordinatorSessionId')
    expect(rc(h)).not.toHaveProperty('coordinatorStopPending')
    h.clock += COORDINATOR_STOP_RETRY_MS * 4
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(1)
  })

  it('a pending mark is retried on the timer as well (nudge), for the app that runs the pass only on commits', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    await h.loop.run()
    await h.settle()
    h.clock += COORDINATOR_STOP_RETRY_MS
    await h.loop.nudge()
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(2)
  })

  it('a session that ended with no exit release is taken as the stop confirmed: slot emptied, mark gone, pause kept', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map((r) => (r.id === 'run_rc' ? { ...r, coordinatorSessionId: 'coord-rc', coordinatorStopPending: NOW, paused: true } : r))
    })
    h.ctx.sessionGone = (id) => id === 'coord-rc'
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
    expect(rc(h)).not.toHaveProperty('coordinatorSessionId')
    expect(rc(h)).not.toHaveProperty('coordinatorStopPending')
    expect(rc(h).paused).toBe(true)
    h.clock += COORDINATOR_STOP_RETRY_MS * 4
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
  })

  it('a finished scheduled Run whose coordinator already ended is released without a stop', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    h.ctx.sessionGone = () => true
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).not.toHaveBeenCalled()
    expect(rc(h)).not.toHaveProperty('coordinatorSessionId')
  })

  it('a session not known to be gone is asked to stop again, as before', async () => {
    const h = rig({ reapableChild: true })
    withCoordinator(h, 'run_rc', 'coord-rc')
    h.ctx.sessionGone = () => false
    await h.loop.run()
    await h.settle()
    h.clock += COORDINATOR_STOP_RETRY_MS
    await h.loop.run()
    await h.settle()
    expect(h.stopCoordinator).toHaveBeenCalledTimes(2)
    expect(rc(h).coordinatorSessionId).toBe('coord-rc')
  })

  // 2026-10-01: `runs stop` / `run-coordinator-stop` from a caller write the mark and stop the session
  // themselves, leaving this loop no backoff entry, so its next pass (the commit's own) resent the stop
  // 12 ms later. The mark's own time is the backoff then.
  const pendingAt = (h: ReturnType<typeof rig>, at: number): void => {
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map((r) =>
        r.id === 'run_rc' ? { ...r, coordinatorSessionId: 'coord-rc', coordinatorStopPending: new Date(at).toISOString(), paused: true } : r
      )
    })
  }
  it('a fresh pending mark a command wrote is not resent on the next pass, only once its interval is over', async () => {
    const h = rig({ reapableChild: true })
    pendingAt(h, h.clock)
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(0)
    h.clock += COORDINATOR_STOP_RETRY_MS - 1
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(0)
    h.clock += 1
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(1)
  })

  it('a pending mark older than the interval (a Host restart) goes out at once', async () => {
    const h = rig({ reapableChild: true })
    pendingAt(h, h.clock - COORDINATOR_STOP_RETRY_MS)
    await h.loop.run()
    await h.settle()
    expect(stops(h)).toBe(1)
  })

  it('a process that does not drive sends nothing, pending mark or not', async () => {
    const h = rig({ reapableChild: true })
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map((r) =>
        r.id === 'run_rc'
          ? { ...r, coordinatorSessionId: 'coord-rc', coordinatorStopPending: NOW }
          : { ...r, coordinatorStartingAt: new Date(NOW_MS - COORDINATOR_START_WINDOW_MS - 1).toISOString() }
      )
    })
    const before = h.state()
    const other = createDispatchLoop({ ...h.ctx, mayStart: () => false })
    await other.run()
    await other.nudge()
    expect(h.handled()).toEqual([])
    expect(h.stopCoordinator).not.toHaveBeenCalled()
    expect(h.state()).toBe(before)
  })
})

// Limits pass L2: a `coordinatorStartingAt` past its window (a start that died with its process) is
// dropped by the driving loop's own pass, so the ▶ comes back without waiting for an unrelated commit.
describe('a stale coordinator start mark is cleared by the pass (L2)', () => {
  const mark = (h: ReturnType<typeof rig>, at: number): void => {
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === 'run_1' ? { ...r, coordinatorStartingAt: new Date(at).toISOString() } : r)) })
  }
  const run1 = (h: ReturnType<typeof rig>) => h.state().runs.find((r) => r.id === 'run_1')!

  it('drops a mark past its window on the pass', async () => {
    const h = rig()
    mark(h, NOW_MS)
    h.clock += COORDINATOR_START_WINDOW_MS + 1
    await h.loop.run()
    await h.settle()
    expect(run1(h)).not.toHaveProperty('coordinatorStartingAt')
  })

  it('drops it on the timer (nudge) as well', async () => {
    const h = rig()
    mark(h, NOW_MS)
    h.clock += COORDINATOR_START_WINDOW_MS + 1
    await h.loop.nudge()
    await h.settle()
    expect(run1(h)).not.toHaveProperty('coordinatorStartingAt')
  })

  it('leaves a mark inside its window alone', async () => {
    const h = rig()
    mark(h, NOW_MS)
    h.clock += COORDINATOR_START_WINDOW_MS - 1
    await h.loop.run()
    await h.loop.nudge()
    await h.settle()
    expect(run1(h).coordinatorStartingAt).toBe(NOW)
  })
})

describe('dispatchOne — one ready Task placed on request (tasks dispatch)', () => {
  /** The Run is placed by nobody: its Job has no autoDispatch and the Run no coordinator, as a Run is
   *  once its coordinator has gone. The loop's own pass leaves it alone. */
  const unplaced = (o: RigOpts = {}) => {
    const h = rig(o)
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, autoDispatch: undefined })) })
    return h
  }

  it('places the Task through the slot the loop uses, on a Run the loop does not place', async () => {
    const h = unplaced()
    await h.loop.run()
    await h.settle()
    expect(h.startWorker).not.toHaveBeenCalled()
    const r = await h.loop.dispatchOne('tsk_2')
    await h.settle()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ taskId: 'tsk_2', runId: 'run_1', sessionId: 's-0', dispatchId: expect.any(String) })
    expect(h.handled()).toEqual(['worker-start'])
    // The loop's placement: concurrency 1 runs in the run worktree.
    expect(h.startWorker.mock.calls[0][0]).toMatchObject({ taskId: 'tsk_2', accountId: 'accA', worktree: '/wt1' })
  })

  it('forks the run worktree first when the run has none, as the loop does', async () => {
    const h = unplaced({ runWithoutWorktree: true })
    const r = await h.loop.dispatchOne('tsk_1')
    expect(r.status).toBe(200)
    expect(h.forked).toHaveLength(1)
    expect(h.handled()).toEqual(['run-worktree-set', 'worker-start'])
  })

  it('what the loop would gate is the answer instead: 409 with the reason, and no Gate', async () => {
    const h = unplaced()
    h.ctx.loginStatus = async () => false
    const r = await h.loop.dispatchOne('tsk_1')
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toContain('tsk_1 was not placed')
    expect(h.handled()).toEqual([])
    expect(h.state().tasks.find((t) => t.id === 'tsk_1')!.status).toBe('ready')
  })

  it('refuses a Task that is not ready and an unknown one', async () => {
    const h = unplaced({ noAccountTask: true })
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => (t.id === 'tsk_1' ? { ...t, status: 'pending' as const } : t)) })
    expect((await h.loop.dispatchOne('tsk_1')).status).toBe(409)
    expect((await h.loop.dispatchOne('tsk_nope')).status).toBe(404)
    expect(h.handled()).toEqual([])
  })

  it('refuses when this process does not drive', async () => {
    const h = unplaced()
    h.ctx.mayStart = () => false
    expect((await h.loop.dispatchOne('tsk_1')).status).toBe(409)
    expect(h.handled()).toEqual([])
  })

  it('a worker-start refusal is handed back as it came', async () => {
    const h = unplaced({ startFailsFor: 'all' })
    const r = await h.loop.dispatchOne('tsk_1')
    expect(r.status).toBe(400)
    expect((r.body as { error: string }).error).toContain('failed to start worker')
    expect(h.handled()).toEqual(['worker-start'])
  })
})

// Review 3, I4 and M1: `dispatchOne` never runs beside a pass, and judges the run after it waited.
describe('dispatchOne — alone, after the pass', () => {
  it('waits for a pass blocked in its fork, and the Task gets exactly one worker-start', async () => {
    const h = rig({ runWithoutWorktree: true })
    let release: () => void = () => {}
    const forkHeld = new Promise<void>((r) => {
      release = r
    })
    let forks = 0
    h.ctx.forkRunWorktree = async () => {
      forks++
      await forkHeld
      return '/wt-forked'
    }
    const pass = h.loop.run()
    await new Promise((r) => setImmediate(r))
    expect(forks).toBe(1) // the pass is inside its fork for tsk_1
    let settled = false
    const asked = h.loop.dispatchOne('tsk_1').then((r) => {
      settled = true
      return r
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false) // it waits for the pass
    expect(forks).toBe(1) // and forks nothing beside it
    release()
    await pass
    const r = await asked
    await h.settle()
    // The pass placed tsk_1; the request then finds it placed and starts nothing.
    expect(r.status).toBe(409)
    expect(h.handled().filter((c) => c === 'worker-start')).toHaveLength(1)
    expect(forks).toBe(1)
  })

  const unplaced = () => {
    const h = rig()
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, autoDispatch: undefined })) })
    return h
  }

  it('a run paused, coordinator-driven or not running by the time it runs is refused, and nothing starts', async () => {
    const paused = unplaced()
    paused.setState({ ...paused.state(), runs: paused.state().runs.map((r) => ({ ...r, paused: true })) })
    expect(((await paused.loop.dispatchOne('tsk_1')).body as { error: string }).error).toContain('paused')
    const coordinated = unplaced()
    coordinated.setState({ ...coordinated.state(), runs: coordinated.state().runs.map((r) => ({ ...r, coordinatorSessionId: 'coord-1' })) })
    expect(((await coordinated.loop.dispatchOne('tsk_1')).body as { error: string }).error).toContain('coordinator')
    const pending = unplaced()
    pending.setState({ ...pending.state(), jobs: pending.state().jobs.map((j) => ({ ...j, pendingStart: true })) })
    expect(((await pending.loop.dispatchOne('tsk_1')).body as { error: string }).error).toContain('not running')
    for (const h of [paused, coordinated, pending]) expect(h.handled()).toEqual([])
  })
})

// P1 carry-over 5: a lost worker handed to a person (the reconciler's review Gate, or the Host's
// lost-worker Gate, R16) comes back through this loop once the Gate is answered. That new attempt is a
// retry of the lost one, exactly as the reconciler's own re-dispatch is (execute.ts's `retryOf`), so the
// Timeline shows it with the retry chip.
describe('a worker revived through a recovery Gate', () => {
  const lostThenGated = () => {
    const h = rig()
    const s = h.state()
    h.setState({
      ...s,
      tasks: s.tasks.map((x) => (x.id === 'tsk_1' ? { ...x, status: 'blocked' as const } : { ...x, status: 'completed' as const })),
      dispatches: [
        { id: 'dsp_lost', taskId: 'tsk_1', provider: 'claude', accountId: 'accA', sessionId: 'sess_gone', cwd: '/wt1', specPath: '/specs/1.md', startedAt: NOW, endedAt: NOW, workerState: 'outcome_unknown', retained: false }
      ],
      gates: [{ id: 'gate_lost', runId: 'run_1', taskId: 'tsk_1', question: 'the worker was lost', options: ['Restart with a new worker'], status: 'open', createdAt: NOW }]
    })
    return h
  }

  it('links the new Dispatch back to the lost one through retryOf once the Gate is answered', async () => {
    const h = lostThenGated()
    expect((await h.real('gate-resolve', { id: 'gate_lost', resolution: 'Restart with a new worker' })).status).toBe(200)
    await h.settle()
    expect(h.startWorker).toHaveBeenCalledTimes(1)
    const fresh = h.state().dispatches.filter((d) => d.id !== 'dsp_lost')
    expect(fresh).toEqual([expect.objectContaining({ taskId: 'tsk_1', retryOf: 'dsp_lost' })])
  })
})

// W2-D: a Run that completes opens its plan's one pull request (`run-open-pr`), once, and only a Run this process saw
// running: the Runs already done on disk get no PR they never asked for.
describe("a completed Run opens its plan's pull request (W2-D)", () => {
  const withWorktree = (h: ReturnType<typeof rig>, runId: string): void => {
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, worktree: '/wt-run' } : r)) })
  }
  const finish = (h: ReturnType<typeof rig>, runId: string): void => {
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t)) })
  }
  const fakePr = (h: ReturnType<typeof rig>): void => {
    // W6-H: the loop asks `run-deliver`, which is `run-open-pr` for a `pr` project
    // T3: the pending mark goes through; an attempt is recorded delivered, as the command does
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-deliver' || args.pending === true) return h.real(cmd, args)
      const s = h.state()
      h.setState({ ...s, runs: s.runs.map((r) => (r.id === args.run ? { ...r, deliveryState: { state: 'delivered' as const, attempts: 1 } } : r)) })
      return { status: 200, body: { url: 'https://github.com/o/r/pull/1' } }
    }
  }
  const asked = (h: ReturnType<typeof rig>): number => h.handled().filter((c) => c === 'run-deliver').length

  it('asks once when a Run it saw running completes', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(0)
    finish(h, 'run_1')
    await h.loop.run()
    await h.settle()
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(1)
  })

  it('T3: a delivery that failed reads failed, is not escalated yet, and is not asked again before its retry time', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    const why = 'git merge-tree says x does not merge cleanly'
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-deliver' || args.pending === true) return h.real(cmd, args)
      const s = h.state()
      const p = { state: 'retrying' as const, attempts: 1, lastError: why, nextRetryAt: new Date(h.clock + 60_000).toISOString() }
      h.setState({ ...s, runs: s.runs.map((r) => (r.id === 'run_1' ? { ...r, pr: { at: NOW, error: why }, deliveryState: p } : r)) })
      return { status: 409, body: { error: why, deliveryState: p } }
    }
    await h.loop.run()
    await h.settle()
    finish(h, 'run_1')
    for (let i = 0; i < 3; i++) {
      await h.loop.run()
      await h.settle()
    }
    expect(asked(h)).toBe(1)
    expect(outcomeOf(h.state(), 'run_1')).toBe('failed')
    expect(h.state().messages.filter((m) => m.type === 'escalation' && m.runId === 'run_1')).toHaveLength(0)
    expect(h.handled()).not.toContain('jobs-replan')
    h.clock += 61_000
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(2)
  })

  it('a manual plan that completes waits for its owner: no auto delivery, awaiting review', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, delivery: 'manual' as const })) })
    await h.loop.run()
    await h.settle()
    finish(h, 'run_1')
    for (let i = 0; i < 3; i++) {
      await h.loop.run()
      await h.settle()
    }
    expect(h.handled().filter((c) => c === 'run-deliver')).toHaveLength(1) // the awaiting-review mark, never `auto`
    expect(h.state().runs.find((r) => r.id === 'run_1')?.deliveryState).toEqual({ state: 'awaiting-review', attempts: 0 })
  })

  it('does not ask for a Run that was already done when it started', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    finish(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(0)
  })
  // W6-H: a push merges the worktrees into the project folder itself, so a Run with no integration branch is asked too
  it('asks a push Job with no integration branch once', async () => {
    const h = rig({ runWithoutWorktree: true })
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, delivery: 'push' as const })) })
    fakePr(h)
    await h.loop.run()
    await h.settle()
    // finished before any worker forked a Run worktree: the Run still has no integration branch
    const t = h.state()
    h.setState({ ...t, runs: t.runs.map(({ worktree: _w, ...r }) => r) })
    finish(h, 'run_1')
    await h.loop.run()
    await h.settle()
    await h.loop.run()
    await h.settle()
    expect(h.state().runs[0].worktree).toBeUndefined()
    expect(asked(h)).toBe(1)
  })

  it('does not ask again once the Run records a delivery', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => ({ ...r, delivery: { at: 'x', sha: 'abc1234' } })) })
    finish(h, 'run_1')
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(0)
  })

  // W8-E (#99): a plan that ended with a failed Task still delivers its completed Tasks' work, never by a push
  const failOne = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({
      ...s,
      tasks: s.tasks.map((t, i) => (i === 0 ? { ...t, status: 'failed' as const, consecutiveFailures: FAILURE_LIMIT } : { ...t, status: 'completed' as const }))
    })
  }
  it('asks once for a pr Run that ended with a failed Task', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    failOne(h)
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(1)
  })
  it('never pushes a Run that ended with a failed Task, and says why once (T3)', async () => {
    const pushes: unknown[] = []
    const h = rig({ deliverPush: async (a) => (pushes.push(a), { ok: true, branch: 'main', sha: 's', merged: [], validated: 0 }) })
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, delivery: 'push' as const })) })
    withWorktree(h, 'run_1')
    await h.loop.run()
    await h.settle()
    failOne(h)
    for (let i = 0; i < 3; i++) {
      await h.loop.run()
      await h.settle()
    }
    expect(pushes).toEqual([])
    expect(asked(h)).toBe(1)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'failed', lastError: expect.stringContaining('failed tasks') })
    expect(h.logs.filter((l) => l.includes('it was not delivered') && l.includes('failed tasks'))).toHaveLength(1)
  })

  // Item 2: a plan that finished with a Task held for the owner delivers its completed work too, never by a push, and
  // once the owner releases that Task and the plan completes, it is delivered again
  const holdOne = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({
      ...s,
      tasks: s.tasks.map((t, i) => (i === 0 ? { ...t, status: 'blocked' as const, result: "Waiting on the owner's decision: drop it?" } : { ...t, status: 'completed' as const }))
    })
  }
  it('asks once for a pr Run that finished with a blocked Task, and again after the owner releases it and it completes', async () => {
    const h = rig()
    withWorktree(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    holdOne(h)
    expect(outcomeOf(h.state(), 'run_1')).toBe('blocked')
    await h.loop.run()
    await h.settle()
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(1)
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t, i) => (i === 0 ? { ...t, status: 'ready' as const } : t)) })
    expect(outcomeOf(h.state(), 'run_1')).toBe('running')
    await h.loop.run()
    await h.settle()
    finish(h, 'run_1')
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(2)
  })
  it('never pushes a Run that finished with a blocked Task', async () => {
    const h = rig()
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, delivery: 'push' as const })) })
    withWorktree(h, 'run_1')
    fakePr(h)
    await h.loop.run()
    await h.settle()
    holdOne(h)
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toBe(0)
  })
})

// T3: a push plan's delivery over the real `run-deliver`, with the Host's push faked: persisted attempts, retries with
// backoff, one owner question, a restart that resumes, an integration Task for a conflict with origin.
describe('T1: a pull request merged on GitHub ends the delivery', () => {
  it('a draft PR the owner merged reads delivered: no gh pr ready, no push, and the loop never attempts it again', async () => {
    const gh: string[][] = []
    const h = rig({
      github: {
        run: async (args: string[]) => {
          gh.push(args)
          return args[1] === 'view' ? { ok: true, stdout: '{"state":"MERGED"}', stderr: '' } : { ok: false, stdout: '', stderr: 'unexpected' }
        },
        push: async () => ({ ok: false, kind: 'rejected', detail: 'must not push' })
      } as unknown as OrchServerDeps['github']
    })
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map((r) => ({ ...r, worktree: '/wt-run', pr: { at: NOW, url: 'https://github.com/o/r/pull/9', number: 9, draft: true as const, error: 'gh pr ready failed' } }))
    })
    await h.loop.run()
    await h.settle()
    const done = h.state()
    h.setState({
      ...done,
      tasks: done.tasks.map((t) => ({ ...t, status: 'completed' as const })),
      dispatches: [],
      runs: done.runs.map((r) => ({ ...r, deliveryState: { state: 'needs-owner' as const, attempts: 5, nextRetryAt: NOW } }))
    })
    await h.loop.run()
    await h.settle()
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered' })
    expect(h.state().runs[0].pr).toMatchObject({ landed: 'merged' })
    expect(h.state().runs[0].pr).not.toHaveProperty('error')
    expect(outcomeOf(h.state(), h.state().runs[0].id)).toBe('completed')
    expect(gh.filter((a) => a[1] !== 'view')).toEqual([])
    const views = gh.length
    h.clock += 2 * 60 * 60_000
    await h.loop.run()
    await h.settle()
    expect(gh).toHaveLength(views)
  })
})

describe('a delivery that finishes by itself (T3)', () => {
  type Push = NonNullable<OrchServerDeps['deliverPush']>
  const pushPlan = (push: Push) => {
    const h = rig({ deliverPush: push })
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, delivery: 'push' as const })), runs: s.runs.map((r) => ({ ...r, worktree: '/wt-run' })) })
    return h
  }
  const finishAll = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => ({ ...t, status: 'completed' as const })), dispatches: [] })
  }
  const pass = async (h: ReturnType<typeof rig>, loop = h.loop): Promise<void> => {
    await loop.run()
    await h.settle()
  }
  const stopped: Push = async () => ({ ok: false, reason: 'git fetch origin main failed: offline', branch: 'main', code: 'fetch-failed' })
  const ok: Push = async () => ({ ok: true, branch: 'main', sha: 'abc1234', merged: [], validated: 0 })

  it('a failed push is retried after nextRetryAt, and a restarted loop over the same state resumes it', async () => {
    let calls = 0
    const h = pushPlan(async (a) => (++calls === 1 ? stopped(a) : ok(a)))
    await pass(h)
    finishAll(h)
    await pass(h)
    await pass(h)
    expect(calls).toBe(1)
    const p = h.state().runs[0].deliveryState!
    expect(p).toMatchObject({ state: 'retrying', attempts: 1, lastError: expect.stringContaining('offline') })
    expect(Date.parse(p.nextRetryAt!)).toBe(h.clock + 60_000)
    // a Host restart: a new loop, nothing in memory, the same state
    const again = freshLoop(h.ctx)
    await pass(h, again)
    expect(calls).toBe(1)
    h.clock += 60_000
    await pass(h, again)
    expect(calls).toBe(2)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered', attempts: 2 })
    expect(h.state().runs[0].delivery).toMatchObject({ sha: 'abc1234' })
  })

  it('after 5 failed attempts exactly one owner question exists, and its answer is acted on', async () => {
    let calls = 0
    let ownerDone = false
    const h = pushPlan(async (a) => (a.ownerPushed ? (ownerDone ? ok(a) : stopped(a)) : (++calls, stopped(a))))
    await pass(h)
    finishAll(h)
    for (let i = 0; i < 8; i++) {
      await pass(h)
      h.clock += 61 * 60_000
    }
    expect(calls).toBeGreaterThanOrEqual(5)
    const questions = h.state().messages.filter((m) => m.type === 'escalation' && m.runId === 'run_1')
    expect(questions).toHaveLength(1)
    expect(questions[0].options).toEqual([DELIVERY_RETRY_NOW, DELIVERY_OWNER_PUSHES])
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', questionId: questions[0].id })
    // "I'll push it myself": git (the fake) is asked whether the commits reached the branch, until they did
    const s = h.state()
    h.setState({ ...s, messages: s.messages.map((m) => (m.id === questions[0].id ? { ...m, answered: true, answerBody: DELIVERY_OWNER_PUSHES } : m)) })
    const before = calls
    await pass(h)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', ownerPushes: true })
    ownerDone = true
    h.clock += 5 * 60_000
    await pass(h)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered-by-owner' })
    expect(calls).toBe(before)
  })

  it('T2: a follow-up Task the owner\'s chat adds to a delivered plan runs, and the plan is delivered again', async () => {
    let calls = 0
    const h = pushPlan(async (a) => (++calls, ok(a)))
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, plannerSessionIds: ['ses-p0'], plannerAccountId: 'accA', replan: 'off' as const })) })
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(calls).toBe(1)
    expect(h.state().runs[0].delivery).toMatchObject({ sha: 'abc1234' })
    const chat = await h.real('jobs-chat', { id: 'job_1' })
    expect(chat.status).toBe(200)
    const sid = (chat.body as { sessionId: string }).sessionId
    const made = await h.as(sid, 'task-create', {
      run: 'run_1',
      account: 'accA',
      title: 'dark mode',
      spec: 'the dark mode part',
      prompt: 'Build dark mode.',
      criteria: ['dark mode works'],
      affectedPaths: ['src/dark.ts'],
      kind: 'feature',
      basis: 'missing',
      evidence: 'no dark mode in src/'
    })
    expect(made.status).toBe(200)
    expect((await h.as(sid, 'jobs-replan-done', { id: 'job_1', summary: 'dark mode Task' })).status).toBe(200)
    await pass(h)
    expect(h.startWorker.mock.calls.some(([a]) => a.taskId === (made.body as Task).id)).toBe(true)
    expect(calls).toBe(1)
    finishAll(h)
    await pass(h)
    await pass(h)
    expect(calls).toBe(2)
    expect(h.state().runs[0].delivery).toMatchObject({ sha: 'abc1234' })
    expect(outcomeOf(h.state(), 'run_1')).toBe('completed')
  })

  it('a follow-up Task on a delivered plan whose worktree was removed makes the worktree again, with no Gate', async () => {
    const h = pushPlan(async (a) => ok(a))
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, plannerSessionIds: ['ses-p0'], plannerAccountId: 'accA', replan: 'off' as const })) })
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(h.state().runs[0].delivery).toMatchObject({ sha: 'abc1234' })
    // delivery took the folder; the Run still names it
    const wt = h.state().runs[0].worktree!
    let there = false
    h.ctx.worktreeGone = async (p) => p === wt && !there
    h.ctx.forkRunWorktree = async (a) => (h.forked.push(a), (there = true), wt)
    const sid = ((await h.real('jobs-chat', { id: 'job_1' })).body as { sessionId: string }).sessionId
    const made = await h.as(sid, 'task-create', {
      run: 'run_1', account: 'accA', title: 'dark mode', spec: 'the dark mode part', prompt: 'Build dark mode.',
      criteria: ['dark mode works'], affectedPaths: ['src/dark.ts'], kind: 'feature', basis: 'missing', evidence: 'no dark mode in src/'
    })
    expect((await h.as(sid, 'jobs-replan-done', { id: 'job_1', summary: 'dark mode Task' })).status).toBe(200)
    await pass(h)
    expect(h.forked).toHaveLength(1)
    expect(h.startWorker.mock.calls.some(([a]) => a.taskId === (made.body as Task).id)).toBe(true)
    expect(h.state().gates ?? []).toEqual([])
  })

  it('a Run finishing, then a restart before delivery, still delivers', async () => {
    let calls = 0
    const h = pushPlan(async (a) => (++calls, ok(a)))
    await pass(h)
    expect(h.state().runs[0].deliveryState).toEqual({ state: 'pending', attempts: 0 })
    finishAll(h)
    const restarted = freshLoop(h.ctx)
    await pass(h, restarted)
    expect(calls).toBe(1)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered' })
  })

  it('a conflict with origin opens an integration Task in the plan', async () => {
    const h = pushPlan(async () => ({ ok: false, reason: 'origin/main moved on and does not merge cleanly', branch: 'main', code: 'origin-conflict', conflictWith: 'f00dfeed' }))
    await pass(h)
    finishAll(h)
    await pass(h)
    const merge = h.state().tasks.find((t) => t.spec.includes('f00dfeed'))
    expect(merge).toBeDefined()
    expect(merge!.runId).toBe('run_1')
  })

  // T5: a hands-free plan mends a failed delivery validation itself
  const checksFailed: Push = async () => ({ ok: false, reason: 'the validation failed on the merged main: npm test exited 1', branch: 'main', code: 'validation-failed' })
  const handsOff = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => ({ ...j, handsOff: true })) })
  }
  const fixes = (h: ReturnType<typeof rig>) => h.state().tasks.filter((t) => t.spec.includes(DELIVERY_FIX_MARK))
  const questions = (h: ReturnType<typeof rig>) => h.state().messages.filter((m) => m.type === 'escalation' && m.runId === 'run_1')

  it('T5: a hands-off plan whose checks fail gets a fix Task, no owner question, and is validated and delivered once it completes', async () => {
    let calls = 0
    const h = pushPlan(async (a) => (++calls === 1 ? checksFailed(a) : ok(a)))
    handsOff(h)
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(fixes(h)).toHaveLength(1)
    expect(fixes(h)[0]).toMatchObject({ runId: 'run_1', spec: expect.stringContaining('npm test exited 1') })
    expect(fixes(h)[0].spec).toContain('git merge --no-edit origin/main')
    expect(h.state().runs[0].deliveryState?.state).not.toBe('needs-owner')
    expect(questions(h)).toEqual([])
    // the fix Task runs, then completes: the delivery is due at once, not after its backoff
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(calls).toBe(2)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered' })
    expect(fixes(h)).toHaveLength(1)
    expect(questions(h)).toEqual([])
  })

  it('T1: a push a pre-push hook refused gets a fix Task quoting the hook output, and is delivered again once it completes', async () => {
    let calls = 0
    const refused: Push = async () => ({
      ok: false,
      reason: 'git push origin main was refused, and origin/main has not moved, so pushing again would not help:\ntypecheck: error TS2345',
      branch: 'main',
      code: 'push-refused'
    })
    const h = pushPlan(async (a) => (++calls === 1 ? refused(a) : ok(a)))
    handsOff(h)
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(fixes(h)).toHaveLength(1)
    expect(fixes(h)[0]).toMatchObject({ runId: 'run_1', spec: expect.stringContaining('error TS2345') })
    expect(questions(h)).toEqual([])
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(calls).toBe(2)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'delivered' })
  })

  it('T1: a fix Task of a plan whose Tasks name no account starts on the account with most room, with no Gate', async () => {
    const h = pushPlan(checksFailed)
    handsOff(h)
    const s = h.state()
    h.setState({ ...s, tasks: s.tasks.map((t) => ({ ...t, accountIds: [] })) })
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(fixes(h)).toHaveLength(1)
    expect(fixes(h)[0].status).toBe('dispatched')
    expect(h.state().gates).toEqual([])
  })

  it('T5: after FAILURE_LIMIT fix Tasks a failed validation asks the owner, and opens no more', async () => {
    const h = pushPlan(checksFailed)
    handsOff(h)
    await pass(h)
    const s = h.state()
    const fix = (n: number): Task => task({ id: `tsk_fix${n}`, parentId: 'tsk_1', spec: `${DELIVERY_FIX_MARK} (fix ${n} of 3)` })
    h.setState({ ...s, tasks: [...s.tasks, fix(1), fix(2), fix(3)] })
    finishAll(h)
    await pass(h)
    expect(fixes(h)).toHaveLength(3)
    expect(questions(h)).toHaveLength(1)
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'needs-owner', lastCode: 'validation-failed' })
  })

  it('T5: a plan that is not hands-free opens no fix Task for failed checks', async () => {
    const h = pushPlan(checksFailed)
    await pass(h)
    finishAll(h)
    await pass(h)
    expect(fixes(h)).toEqual([])
    expect(h.state().runs[0].deliveryState).toMatchObject({ state: 'retrying', attempts: 1 })
  })
})

// W6-D: a wave boundary replans before the next wave, and a completed Run gets its final check before its PR.
describe('wave replanning (W6-D)', () => {
  /** job_1 planned (so it replans), tsk_2 waiting on tsk_1. */
  const planned = (h: ReturnType<typeof rig>, tasks: (t: Task) => Task): void => {
    const s = h.state()
    h.setState({
      ...s,
      jobs: s.jobs.map((j) => (j.id === 'job_1' ? { ...j, plannerSessionIds: ['ses-planner'], coordinatorAccountId: 'accA', concurrency: 2 } : j)),
      tasks: s.tasks.map((t) => tasks({ ...t, prompt: 'p', acceptanceCriteria: ['c'], affectedPaths: [`src/${t.id}`], basis: { state: 'missing', evidence: 'e' }, ...(t.id === 'tsk_2' ? { deps: ['tsk_1'] } : {}) }))
    })
  }

  /** tsk_1 failed an attempt and then succeeded: the retry reset its count, so the Dispatch says it deviated. */
  const failedOnce = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({ ...s, dispatches: [...s.dispatches, { id: 'dsp_failed', taskId: 'tsk_1', outcome: 'failed', workerState: 'failed', sessionId: 'ses-dead', provider: 'claude', accountId: 'acc1', cwd: '/repo', specPath: '/s.md', startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:01:00.000Z' } as Dispatch] })
  }

  it('starts a replan when a Task deviates, and holds only the Tasks it can affect, not the Job', async () => {
    const h = rig()
    planned(h, (t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' } : t))
    failedOnce(h)
    // tsk_3 neither waits on tsk_1 nor shares its paths
    const s = h.state()
    h.setState({ ...s, tasks: [...s.tasks, task({ id: 'tsk_3', prompt: 'p', acceptanceCriteria: ['c'], affectedPaths: ['src/tsk_3'], basis: { state: 'missing', evidence: 'e' } })] })
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toContain('jobs-replan')
    const job = h.state().jobs.find((j) => j.id === 'job_1')!
    expect(job.dispatchHold).toBeUndefined()
    expect(job.replanning).toMatchObject({ runId: 'run_1', mode: 'wave', wave: 1, scoped: true })
    expect(h.startCoordinator).toHaveBeenCalledWith(expect.objectContaining({ role: 'planner', runId: 'job_1' }))
    expect(h.startWorker.mock.calls.map((c) => JSON.stringify(c))).toEqual([expect.stringContaining('tsk_3')])
  })

  it('runs the final check before the PR, and opens the PR once it settles', async () => {
    const h = rig()
    planned(h, (t) => t)
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => ({ ...r, worktree: '/wt-run' })) })
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-deliver' || args.pending === true) return h.real(cmd, args)
      const st = h.state()
      h.setState({ ...st, runs: st.runs.map((r) => ({ ...r, deliveryState: { state: 'delivered' as const, attempts: 1 } })) })
      return { status: 200, body: { url: 'u' } }
    }
    h.startWorker.mockImplementation(async () => ({ sessionId: 'w', cwd: '/wt-run', specPath: 'x' }))
    await h.loop.run()
    await h.settle()
    const now = h.state()
    h.setState({ ...now, tasks: now.tasks.map((t) => ({ ...t, status: 'completed' as const })), dispatches: [] })
    await h.loop.run()
    await h.settle()
    expect(h.state().jobs[0].replanning).toMatchObject({ mode: 'completion' })
    expect(h.handled()).not.toContain('run-open-pr')
    const session = h.state().jobs[0].replanning!.sessionId!
    expect((await h.as(session, 'jobs-replan-done', { id: 'job_1', summary: 'meets the objective' })).status).toBe(200)
    await h.loop.run()
    await h.settle()
    expect(h.handled().filter((c) => c === 'run-deliver')).toHaveLength(1)
  })

  it('ends a replan whose planner session is gone', async () => {
    const h = rig()
    planned(h, (t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' } : t))
    failedOnce(h)
    await h.loop.run()
    await h.settle()
    h.ctx.sessionGone = () => true
    await h.loop.nudge()
    await h.settle()
    const job = h.state().jobs[0]
    expect(job.replanning).toBeUndefined()
    expect(job.dispatchHold).toBeUndefined()
    expect(job.lastReplan?.summary).toContain('its planner session ended')
  })

  it('reminds a replan planner idle at its prompt once, and ends it as skipped after 30 minutes', async () => {
    const h = rig()
    planned(h, (t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' } : t))
    failedOnce(h)
    const start = h.clock
    await h.loop.run()
    await h.settle()
    const session = h.state().jobs[0].replanning!.sessionId!
    // first seen idle now; the reminder waits REPLAN_IDLE_NUDGE_MS from here, and busy time does not count
    await h.loop.nudge()
    await h.settle()
    h.ctx.sessionBusy = () => true
    h.clock = start + REPLAN_IDLE_NUDGE_MS + 1
    await h.loop.nudge()
    await h.settle()
    h.ctx.sessionBusy = () => false
    await h.loop.nudge()
    await h.settle()
    expect(h.typed.filter((t) => t.includes('jobs-replan-done'))).toHaveLength(0)
    h.clock = start + 2 * REPLAN_IDLE_NUDGE_MS + 2
    await h.loop.nudge()
    await h.settle()
    await h.loop.nudge()
    await h.settle()
    expect(h.typed.filter((t) => t.includes('astera jobs-replan-done --id job_1'))).toHaveLength(1)
    expect(h.state().jobs[0].replanning).toBeDefined()

    h.clock = start + REPLAN_TIMEOUT_MS + 1
    await h.loop.nudge()
    await h.settle()
    const job = h.state().jobs[0]
    expect(job.replanning).toBeUndefined()
    expect(job.dispatchHold).toBeUndefined()
    expect(job.lastReplan).toMatchObject({ mode: 'wave', wave: 1 })
    expect(job.lastReplan?.summary).toMatch(/^Replan skipped: its planner did not finish in time/)
    expect(h.stopCoordinator).toHaveBeenCalledWith(session, expect.any(String))
  })

  it('neither reminds nor ends a chat replan with its owner, however long it is idle', async () => {
    const h = rig()
    planned(h, (t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' } : t))
    failedOnce(h)
    const start = h.clock
    await h.loop.run()
    await h.settle()
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => (j.id === 'job_1' ? { ...j, replanning: { ...j.replanning!, chat: true } } : j)) })
    await h.loop.nudge()
    await h.settle()
    h.clock = start + REPLAN_TIMEOUT_MS + 1
    await h.loop.nudge()
    await h.settle()
    await h.loop.nudge()
    await h.settle()
    expect(h.typed).toHaveLength(0)
    expect(h.handled()).not.toContain('jobs-replan-done')
    expect(h.state().jobs[0].replanning).toBeDefined()
  })

  it.each([
    ['the owner', 'Lift the hold'],
    ['a hands-off coordinator', 'lift the hold. Why: tsk_2 was planned without a prompt; the item is missing']
  ])("lifts an escalated replan's hold once %s answers its Inbox item with the lift", async (_who, answer) => {
    const h = rig()
    planned(h, (t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' } : t))
    const at = new Date(h.clock).toISOString()
    const why = 'the plan does not hold after the replan: tsk_2 has no prompt'
    const esc: Message = {
      id: 'msg_esc',
      runId: 'run_1',
      type: 'escalation',
      subject: `Replan escalated, the plan is held: ${why}`,
      body: why,
      options: [REPLAN_LIFT_HOLD],
      answered: false,
      createdAt: at
    }
    const s = h.state()
    h.setState({
      ...s,
      jobs: s.jobs.map((j) => (j.id === 'job_1' ? { ...j, dispatchHold: true, lastReplan: { runId: 'run_1', mode: 'wave', wave: 1, done: 1, at, summary: why, escalated: why } } : j)),
      messages: [...s.messages, esc]
    })
    await h.loop.nudge()
    await h.settle()
    expect(h.state().jobs[0].dispatchHold).toBe(true)
    expect((await h.real('questions-answer', { id: 'msg_esc', answer })).status).toBe(200)
    await h.loop.nudge()
    await h.settle()
    expect(h.handled()).toContain('jobs-unhold')
    expect(h.state().jobs[0].dispatchHold).toBeUndefined()
  })
})

// W8-C: a long `pr` plan's draft PR is asked once per finished wave while later waves remain, and the completed Run's
// delivery still comes for a Run whose PR is that draft.
// T36: a plan never stalls silently on a failed Task: a replan first when the plan replans, else (or after it) one
// owner question, whose answer the loop carries out.
describe('a Run stalled on a failed Task (T36)', () => {
  /** tsk_1 failed (its worker reported failed), tsk_2 waits on it, nothing else runs. */
  const failedFirst = (h: ReturnType<typeof rig>, job: Partial<Job> = {}): void => {
    const s = h.state()
    h.setState({
      ...s,
      jobs: s.jobs.map((j) => ({ ...j, title: 'Shots', ...job })),
      tasks: s.tasks.map((t) =>
        t.id === 'tsk_1'
          ? { ...t, status: 'failed' as const, consecutiveFailures: 1, result: 'made 19 screens, gaps listed', prompt: 'p', acceptanceCriteria: ['c'], affectedPaths: ['src/a'], basis: { state: 'missing' as const, evidence: 'e' } }
          : { ...t, status: 'pending' as const, deps: ['tsk_1'], prompt: 'p', acceptanceCriteria: ['c'], affectedPaths: ['src/b'], basis: { state: 'missing' as const, evidence: 'e' } }
      )
    })
  }
  const asked = (h: ReturnType<typeof rig>) => h.state().messages.filter((m) => m.type === 'escalation' && m.taskId === 'tsk_1' && m.options?.length === 3)

  it('with replanning off: one pass asks the owner once, logs the stall once, and carries out the answer', async () => {
    const h = rig()
    failedFirst(h)
    await h.loop.run()
    await h.settle()
    expect(asked(h)).toHaveLength(1)
    expect(asked(h)[0].subject).toBe('Shots: 1 Task wait on failed tsk_1: made 19 screens, gaps listed')
    expect(asked(h)[0].options).toEqual(['Retry', 'Accept as done', 'Cancel what waits on it'])
    await h.loop.run()
    await h.loop.nudge()
    await h.settle()
    expect(asked(h)).toHaveLength(1)
    expect(h.logs.filter((l) => l.startsWith('run=run_1 stalled: waiting on tsk_1'))).toHaveLength(1)

    expect((await h.real('questions-answer', { id: asked(h)[0].id, answer: 'Accept as done' })).status).toBe(200)
    await h.loop.run()
    await h.settle()
    const t1 = h.state().tasks.find((t) => t.id === 'tsk_1')!
    expect(t1.status).toBe('completed')
    expect(t1.completionOverride?.reason).toContain('made 19 screens')
    expect(h.handled()).toContain('task-failed-resolve')
  })

  it('a hands-off plan still asks the owner, and the answer Retry runs the Task again', async () => {
    const h = rig()
    failedFirst(h, { handsOff: true })
    await h.loop.run()
    await h.loop.nudge()
    await h.settle()
    expect(asked(h)).toHaveLength(1)
    expect(asked(h)[0].answered).toBe(false)
    await h.real('questions-answer', { id: asked(h)[0].id, answer: 'Retry' })
    await h.loop.run()
    await h.settle()
    expect(h.state().tasks.find((t) => t.id === 'tsk_1')).toMatchObject({ status: 'ready', consecutiveFailures: 0 })
    // the commit's own pass places it
    await h.loop.run()
    await h.settle()
    expect(h.startWorker.mock.calls.map((c) => JSON.stringify(c)).some((c) => c.includes('tsk_1'))).toBe(true)
  })

  it('with replanning on: a scoped replan first, and the owner is asked once it ended with the Task still failed', async () => {
    const h = rig()
    failedFirst(h, { plannerSessionIds: ['ses-planner'], coordinatorAccountId: 'accA' })
    await h.loop.run()
    await h.settle()
    expect(h.handled()).toContain('jobs-replan')
    expect(h.state().jobs[0].replanning).toMatchObject({ scoped: true })
    expect(asked(h)).toHaveLength(0)
    const session = h.state().jobs[0].replanning!.sessionId!
    h.clock += 60_000
    expect((await h.as(session, 'jobs-replan-done', { id: 'job_1', summary: 'left it' })).status).toBe(200)
    await h.loop.run()
    await h.settle()
    expect(h.handled().filter((c) => c === 'jobs-replan')).toHaveLength(1)
    expect(asked(h)).toHaveLength(1)
  })
})

describe('a long plan keeps a draft PR (W8-C)', () => {
  const twoWaves = (h: ReturnType<typeof rig>, first: Task['status'], second: Task['status']): void => {
    const s = h.state()
    h.setState({
      ...s,
      tasks: s.tasks.map((t) => (t.id === 'tsk_1' ? { ...t, status: first } : { ...t, deps: ['tsk_1'], status: second }))
    })
  }
  const fake = (h: ReturnType<typeof rig>): void => {
    h.ctx.handle = async (cmd, args) => {
      if (cmd === 'run-draft-pr') {
        const s = h.state()
        const done = s.tasks.filter((t) => t.runId === 'run_1' && t.status === 'completed').length
        const push = s.jobs[0].delivery === 'push'
        h.setState({
          ...s,
          runs: s.runs.map((r) => ({
            ...r,
            ...(push ? {} : { pr: { at: NOW, url: 'u', draft: true as const, wavesDone: 1 } }),
            branchPush: { state: 'delivered' as const, attempts: 1, tasksDone: done }
          }))
        })
        return { status: 200, body: push ? { pushed: true } : { url: 'u', opened: true } }
      }
      if (cmd === 'run-deliver' && args.pending !== true) {
        const s = h.state()
        h.setState({ ...s, runs: s.runs.map((r) => ({ ...r, deliveryState: { state: 'delivered' as const, attempts: 1 } })) })
        return { status: 200, body: { url: 'u' } }
      }
      return h.real(cmd, args)
    }
  }
  const count = (h: ReturnType<typeof rig>, cmd: string): number => h.handled().filter((c) => c === cmd).length

  it('T3: asks once per Task merged, then delivers the draft Run at completion', async () => {
    const h = rig()
    fake(h)
    twoWaves(h, 'completed', 'pending')
    await h.loop.run()
    await h.settle()
    await h.loop.run()
    await h.settle()
    expect(count(h, 'run-draft-pr')).toBe(1)
    expect(count(h, 'run-deliver')).toBe(0)
    twoWaves(h, 'completed', 'completed')
    await h.loop.run()
    await h.settle()
    expect(count(h, 'run-draft-pr')).toBe(2)
    expect(count(h, 'run-deliver')).toBe(1)
  })

  it('T3: a one-wave plan and a push delivery push their plan branch after each Task too', async () => {
    const one = rig()
    fake(one)
    const s = one.state()
    one.setState({ ...s, tasks: s.tasks.map((t) => (t.id === 'tsk_1' ? { ...t, status: 'completed' as const } : t)) })
    await one.loop.run()
    await one.settle()
    expect(count(one, 'run-draft-pr')).toBe(1)
    const push = rig()
    fake(push)
    const p = push.state()
    push.setState({ ...p, jobs: p.jobs.map((j) => ({ ...j, delivery: 'push' as const })) })
    twoWaves(push, 'completed', 'pending')
    await push.loop.run()
    await push.settle()
    expect(count(push, 'run-draft-pr')).toBe(1)
  })

  it('T3: a failed branch push is retried after its retry time, not before', async () => {
    const h = rig()
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-draft-pr') return h.real(cmd, args)
      const s = h.state()
      h.setState({
        ...s,
        runs: s.runs.map((r) => ({ ...r, branchPush: { state: 'retrying' as const, attempts: 1, lastError: 'offline', nextRetryAt: new Date(h.clock + 60_000).toISOString() } }))
      })
      return { status: 409, body: { error: 'offline' } }
    }
    twoWaves(h, 'completed', 'pending')
    await h.loop.run()
    await h.settle()
    await h.loop.run()
    await h.settle()
    expect(count(h, 'run-draft-pr')).toBe(1)
    h.clock += 61_000
    await h.loop.run()
    await h.settle()
    expect(count(h, 'run-draft-pr')).toBe(2)
  })
})

// W8-C plan after plan: a queued plan's planner starts by itself once the plan it waits on is delivered; one that
// stopped leaves it waiting, escalated once (`jobs-after-sweep`, Job.afterStopNotified).
describe('a plan queued after another (W8-C)', () => {
  const queue = (h: ReturnType<typeof rig>, prev: Partial<Job>, run?: Record<string, unknown>, taskStatus?: Task['status']): void => {
    const s = h.state()
    h.setState({
      ...s,
      jobs: [
        ...s.jobs,
        { id: 'job_prev', objective: 'first', cwd: '/p', createdAt: NOW, ...prev },
        { id: 'job_q', objective: 'second', cwd: '/p', createdAt: NOW, pendingStart: true, coordinatorAccountId: 'accA', after: 'job_prev' }
      ],
      runs: run ? [...s.runs, { id: 'run_prev', jobId: 'job_prev', ordinal: 1, createdAt: NOW, ...run }] : s.runs,
      tasks: taskStatus
        ? [...s.tasks, task({ id: 'tsk_prev', runId: 'run_prev', status: taskStatus, consecutiveFailures: taskStatus === 'failed' ? 3 : 0 })]
        : s.tasks
    })
  }
  const pass = async (h: ReturnType<typeof rig>): Promise<void> => {
    await h.loop.run()
    await h.settle()
  }
  const planned = (h: ReturnType<typeof rig>): number => h.startCoordinator.mock.calls.filter(([a]) => a.runId === 'job_q').length

  it('starts the planner once the plan it waits on is delivered (a pull request opened), once', async () => {
    const h = rig()
    queue(h, {}, { pr: { at: NOW, url: 'https://github.com/o/r/pull/1' } }, 'completed')
    await pass(h)
    await pass(h)
    expect(planned(h)).toBe(1)
    expect(h.state().jobs.find((j) => j.id === 'job_q')?.plannerSessionIds).toEqual(['coord-job_q'])
  })

  it('waits while the plan it waits on is not delivered, a draft pull request included', async () => {
    const h = rig()
    queue(h, {}, { pr: { at: NOW, url: 'u', draft: true } }, 'completed')
    await pass(h)
    expect(planned(h)).toBe(0)
    expect(h.handled()).not.toContain('jobs-plan')
    expect(h.handled()).not.toContain('jobs-after-sweep')
  })

  it('waits and escalates exactly once when the plan it waits on gave up', async () => {
    const h = rig()
    queue(h, {}, {}, 'failed')
    await pass(h)
    await pass(h)
    expect(planned(h)).toBe(0)
    expect(h.state().jobs.find((j) => j.id === 'job_q')?.afterStopNotified).toBeDefined()
    expect(h.handled().filter((c) => c === 'jobs-after-sweep')).toHaveLength(1)
  })

  it('waits and escalates when the plan it waits on is archived; starts once it is delivered after all', async () => {
    const h = rig()
    queue(h, { archivedAt: NOW })
    await pass(h)
    expect(h.state().jobs.find((j) => j.id === 'job_q')?.afterStopNotified).toBeDefined()
    expect(planned(h)).toBe(0)
    const s = h.state()
    h.setState({ ...s, jobs: s.jobs.map((j) => (j.id === 'job_prev' ? { ...j, nothingToDo: { at: NOW, summary: 'built' } } : j)) })
    await pass(h)
    expect(planned(h)).toBe(1)
  })
})

// #117: a hands-off plan runs to its end with nothing in the owner's Inbox, and every call it made recorded
describe('a hands-off plan decides for the owner (#117)', () => {
  it('an exhausted Gate (retry-once, then mark-failed) and an escalation its coordinator decides: zero Inbox items, three decisions', async () => {
    const T = Date.parse('2026-10-19T00:00:00.000Z')
    let clock = T
    let state: OrchState = emptyState()
    const deps = {
      getState: () => state,
      setState: async (next: OrchState) => {
        state = next
      },
      listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
      now: () => new Date(clock).toISOString()
    } as unknown as OrchServerDeps
    const host = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
    await host('run-create', { objective: 'o', cwd: '/p' })
    await host('task-create', { spec: 's', account: 'acc1', title: 'T1 · Login' })
    // A second Task keeps the plan running once the first is given up
    await host('task-create', { spec: 's', account: 'acc1', title: 'T2 · Signup' })
    const taskId = state.tasks[0].id
    const runId = state.runs[0].id
    state = {
      ...state,
      jobs: state.jobs.map((j) => ({ ...j, handsOff: true })),
      runs: state.runs.map((r) => ({ ...r, coordinatorSessionId: 'coord_1' }))
    }
    const exhausted = async (): Promise<string> => {
      const r = await host('gate-create', { task: taskId, question: 'Checks failed 3 times' })
      const id = (r.body as { id: string }).id
      // The Host's own kind and answers, as gateOnFailure opens it
      state = { ...state, gates: state.gates.map((g) => (g.id === id ? { ...g, kind: 'convergence-exhausted' as const, options: ['retry-once', 'mark-failed'] } : g)) }
      return id
    }
    const g1 = await exhausted()
    const other = state.tasks[1].id
    const escalation: Message = { id: 'msg_esc1', runId, type: 'escalation', taskId: other, subject: 'Blue or green for the button?', body: '', answered: false, createdAt: new Date(clock).toISOString() }
    state = { ...state, messages: [...state.messages, escalation] }
    const loop = createDispatchLoop({
      handle: host,
      getState: () => state,
      accounts: () => [],
      loginStatus: async () => true,
      lang: () => 'en',
      sessionAlive: () => true,
      sessionBusy: () => null,
      typeInto: () => {},
      // The global setting is off: a hands-off plan is answered anyway
      autoAnswer: () => false,
      activity: () => {},
      recordDecision: async (jobId: string, d: Parameters<typeof addDecision>[2]) => {
        state = addDecision(state, jobId, d)
      },
      mayStart: () => true,
      log: () => {},
      nowMs: () => clock
    } as unknown as DispatchLoopContext)
    const tick = async (ms: number): Promise<void> => {
      clock += ms
      await loop.nudge()
    }

    await tick(1_000)
    expect(state.gates.find((g) => g.id === g1)).toMatchObject({ status: 'resolved', resolution: 'retry-once' })
    // The escalation is its coordinator's first: nothing within the grace
    expect(state.messages.some((m) => m.subject.startsWith('Decide for the owner'))).toBe(false)

    // The retry failed too: the next exhausted Gate is given up, so the plan carries on
    state = { ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: 'ready' as const } : t)) }
    const g2 = await exhausted()
    await tick(ASK_GRACE_MS)
    expect(state.gates.find((g) => g.id === g2)).toMatchObject({ status: 'resolved', resolution: 'mark-failed' })
    const told = state.messages.filter((m) => m.subject === 'Decide for the owner: msg_esc1')
    expect(told).toHaveLength(1)
    expect(told[0].body).toContain('astera questions answer --id msg_esc1')

    // The coordinator decides in the owner's place; the Host records it on its next tick
    const answered = await handleCommand(deps, { sessionId: 'coord_1' }, 'questions-answer', { id: 'msg_esc1', answer: 'blue: it matches the brand colours' })
    expect(answered).toMatchObject({ status: 200 })
    await tick(1_000)
    await tick(1_000)
    expect(state.jobs[0].decisions?.map((d) => [d.kind, d.choice])).toEqual([
      ['gate', 'retry-once'],
      ['gate', 'mark-failed'],
      ['escalation', 'blue: it matches the brand colours']
    ])
    expect(state.jobs[0].decisions?.[2]).toMatchObject({ taskId: other, question: 'Blue or green for the button?', why: 'blue: it matches the brand colours' })

    const tree = [{ id: 'p1', name: 'P', path: '/p', plans: [{ jobId: state.jobs[0].id, projectId: 'p1', name: 'o', planner: [], coordinator: [], workers: [] }] }]
    const inbox = (jobs: Job[]) =>
      needsInput({ tree, jobs, runs: state.runs, tasks: state.tasks, gates: state.gates, escalations: [...state.messages.filter((m) => m.type === 'escalation'), { ...escalation, id: 'msg_esc2' }], attention: {} })
    expect(inbox(state.jobs)).toEqual([])
    // The same state on a plan that is not hands-off would hold the still-open escalation for the owner
    expect(inbox(state.jobs.map((j) => ({ ...j, handsOff: false }))).map((i) => i.kind)).toEqual(['escalation'])
  })
})

// T11: deliveries across plans of one project never collide
describe('plans of one project: one delivery at a time, the others refreshed onto it (T11)', () => {
  const LATER = new Date(NOW_MS + 1000).toISOString()
  /** Plan B is the rig's job_1 (its Run in /wt1); plan A, of the same project folder, delivered `shaA` after B began. */
  const withDeliveredA = (h: ReturnType<typeof rig>): void => {
    const s = h.state()
    h.setState({
      ...s,
      jobs: [...s.jobs.map((j) => ({ ...j, title: 'B' })), { id: 'job_A', title: 'A', objective: 'a', cwd: '/p', createdAt: NOW }],
      runs: [...s.runs, { id: 'run_A', jobId: 'job_A', ordinal: 1, createdAt: NOW, worktree: '/wtA', delivery: { at: LATER, sha: 'shaA', branch: 'main' } }],
      tasks: [...s.tasks, task({ id: 'tsk_A', runId: 'run_A', jobId: 'job_A', status: 'completed' })]
    })
  }
  const lines = (h: ReturnType<typeof rig>): string[] => {
    const out: string[] = []
    h.ctx.activity = (d) => void out.push(String(d.payload.reason))
    return out
  }

  it("merges plan A's delivery into plan B's Run worktree before B's next Task starts, once", async () => {
    const h = rig()
    withDeliveredA(h)
    const feed = lines(h)
    const refresh = vi.fn(async () => ({ kind: 'merged' as const }))
    h.ctx.refreshOnto = refresh
    await h.loop.run()
    await h.settle()
    expect(refresh).toHaveBeenCalledWith('/wt1', 'shaA', "Refresh onto plan A's delivery", 'main', '/p')
    expect(h.startWorker).toHaveBeenCalled()
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(h.startWorker.mock.invocationCallOrder[0])
    expect(feed.filter((l) => l.startsWith("Plan B refreshed onto plan A's delivery"))).toHaveLength(1)
    await h.loop.run()
    await h.settle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a refresh that conflicts creates an integration Task in plan B instead of stopping', async () => {
    const h = rig()
    withDeliveredA(h)
    const feed = lines(h)
    h.ctx.refreshOnto = async () => ({ kind: 'conflict', reason: 'shaA does not merge cleanly into /wt1' })
    await h.loop.run()
    await h.settle()
    const merge = h.state().tasks.find((t) => t.runId === 'run_1' && t.spec.includes('shaA'))
    expect(merge).toBeDefined()
    expect(h.state().gates.filter((g) => g.status === 'open')).toEqual([])
    // Plan B's own Tasks wait for it: the one worker is the integration Task's
    expect(h.state().tasks.filter((t) => t.id === 'tsk_1' || t.id === 'tsk_2').map((t) => t.status)).toEqual(['ready', 'ready'])
    expect(feed.some((l) => l.startsWith("Integration Task created in plan B for its conflict with plan A's delivery"))).toBe(true)
    await h.loop.run()
    await h.settle()
    expect(h.state().tasks.filter((t) => t.runId === 'run_1' && t.spec.includes('shaA'))).toHaveLength(1)
  })

  /** Plan A's pull request, which the PR poll saw merged (`attribution-remap`) after plan B began. */
  const withMergedPrA = (h: ReturnType<typeof rig>): void => {
    withDeliveredA(h)
    const s = h.state()
    h.setState({
      ...s,
      runs: s.runs.map(({ delivery: _d, ...r }) =>
        r.id === 'run_A' ? { ...r, pr: { at: NOW, url: 'u', attributed: 'mergeA', attributedAt: LATER, baseRefName: 'main' } } : r
      )
    })
  }

  it("a merged pull request of plan A refreshes plan B too, fetching origin's branch", async () => {
    const h = rig()
    withMergedPrA(h)
    const feed = lines(h)
    const refresh = vi.fn(async () => ({ kind: 'merged' as const }))
    h.ctx.refreshOnto = refresh
    await h.loop.run()
    await h.settle()
    expect(refresh).toHaveBeenCalledWith('/wt1', 'mergeA', "Refresh onto plan A's delivery", 'main', '/p')
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(h.startWorker.mock.invocationCallOrder[0])
    expect(feed.some((l) => l.startsWith("Plan B refreshed onto plan A's delivery"))).toBe(true)
  })

  it('a merged pull request of plan A that conflicts creates an integration Task in plan B', async () => {
    const h = rig()
    withMergedPrA(h)
    const feed = lines(h)
    h.ctx.refreshOnto = async () => ({ kind: 'conflict', reason: 'mergeA does not merge cleanly into /wt1' })
    await h.loop.run()
    await h.settle()
    expect(h.state().tasks.filter((t) => t.runId === 'run_1' && t.spec.includes('mergeA'))).toHaveLength(1)
    expect(feed.some((l) => l.startsWith("Integration Task created in plan B for its conflict with plan A's delivery"))).toBe(true)
  })

  it('a pull request merged before plan B began, or not merged, refreshes nothing', async () => {
    const h = rig()
    withMergedPrA(h)
    const s = h.state()
    h.setState({ ...s, runs: s.runs.map((r) => (r.id === 'run_A' ? { ...r, pr: { at: NOW, url: 'u', attributed: 'mergeA', attributedAt: new Date(NOW_MS - 1000).toISOString() } } : r)) })
    const refresh = vi.fn(async () => ({ kind: 'merged' as const }))
    h.ctx.refreshOnto = refresh
    await h.loop.run()
    await h.settle()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('delivers at most one plan of a project at a time', async () => {
    const h = rig()
    const s = h.state()
    h.setState({
      ...s,
      jobs: [
        ...s.jobs.map((j) => ({ ...j, delivery: 'push' as const })),
        { id: 'job_2', objective: 'second', cwd: '/p', createdAt: NOW, concurrency: 1, autoDispatch: true, delivery: 'push' as const }
      ],
      runs: [...s.runs, { id: 'run_2', jobId: 'job_2', ordinal: 1, createdAt: NOW, worktree: '/wt2' }],
      tasks: [...s.tasks, task({ id: 'tsk_3', runId: 'run_2', jobId: 'job_2' })]
    })
    let inFlight = 0
    let most = 0
    const delivered: string[] = []
    h.ctx.handle = async (cmd, args) => {
      if (cmd !== 'run-deliver') return h.real(cmd, args)
      most = Math.max(most, ++inFlight)
      await new Promise<void>((r) => setTimeout(r, 5))
      inFlight--
      delivered.push(String(args.run))
      return { status: 200, body: { sha: 'x', branch: 'main' } }
    }
    await h.loop.run()
    await h.settle()
    const t = h.state()
    h.setState({ ...t, tasks: t.tasks.map((x) => ({ ...x, status: 'completed' as const })) })
    // Two passes at once, as two ticks would
    await Promise.all([h.loop.run(), h.loop.run()])
    await h.settle()
    expect(delivered.sort()).toEqual(['run_1', 'run_2'])
    expect(most).toBe(1)
  })
})

// T25: a planner start that found no account with room (Job.startWait) is asked again by the loop's tick, with no press.
describe('a held planner start (T25)', () => {
  it('is asked again on the next tick and starts once an account has room', async () => {
    const h = rig()
    const s = h.state()
    h.setState({
      ...s,
      jobs: [...s.jobs, { id: 'job_h', objective: 'held', cwd: '/p', createdAt: NOW, pendingStart: true, coordinatorAccountId: 'accA', startWait: 'no claude account has room' }]
    })
    h.startCoordinator.mockImplementationOnce(async (a) => {
      await (a as { onWait?: (w: string | null) => Promise<void> }).onWait?.(null)
      return { sessionId: 'coord-held' }
    })
    await h.loop.run()
    await h.settle()
    expect(h.startCoordinator.mock.calls.filter(([a]) => a.runId === 'job_h')).toHaveLength(1)
    const job = h.state().jobs.find((j) => j.id === 'job_h')
    expect(job?.plannerSessionIds).toEqual(['coord-held'])
    expect(job).not.toHaveProperty('startWait')
  })
})

// T3: the planner's --worktree reuse, the one-implementer-per-folder guard, and the safe-merge hand-off of a dirty worktree
describe('a Task that reuses its dep worktree (T3)', () => {
  const ended = (id: string, taskId: string, cwd: string): Dispatch =>
    ({ id, taskId, provider: 'claude', accountId: 'accA', sessionId: `w-${id}`, cwd, specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded' }) as Dispatch
  /** An app-driven Run of width 2 on /wt1: A finished in /wt-a and waits for its merge, B (reuse) and C wait for A. */
  const reuseRig = (b: Partial<Task> = {}) => {
    const h = rig({ concurrency: 2 })
    h.setState({
      ...h.state(),
      tasks: [
        task({ id: 'tsk_A', status: 'merging' }),
        task({ id: 'tsk_B', status: 'pending', deps: ['tsk_A'], worktree: 'reuse', ...b }),
        task({ id: 'tsk_C', status: 'pending', deps: ['tsk_A'] })
      ],
      dispatches: [ended('dsp_a', 'tsk_A', '/wt-a')]
    })
    const merges: { root: string; paths: string[]; reap?: boolean }[] = []
    h.ctx.integrate = async (root, paths, _heads, opts) => (merges.push({ root, paths, reap: opts?.reap }), { kind: 'merged', uncommitted: 0 })
    h.ctx.isRegisteredWorktree = (p) => p === '/wt-a'
    return { h, merges }
  }
  const startOf = (h: ReturnType<typeof rig>, taskId: string) => h.startWorker.mock.calls.map((c) => c[0]).find((a) => a.taskId === taskId)

  it('keeps the dep worktree at its merge, merges the plan branch into it and starts the reuser there', async () => {
    const { h, merges } = reuseRig()
    await h.loop.nudge()
    await h.settle()
    expect(h.state().tasks.find((t) => t.id === 'tsk_A')!.status).toBe('completed')
    // the dep is merged into the plan branch, its folder kept (reap false); then the plan branch into that folder
    expect(merges[0]).toEqual({ root: '/wt1', paths: ['/wt-a'], reap: false })
    expect(merges).toContainEqual({ root: '/wt-a', paths: ['/wt1'], reap: false })
    expect(startOf(h, 'tsk_B')?.worktree).toBe('/wt-a')
    expect(startOf(h, 'tsk_C')?.worktree).toBe('new')
    expect(h.reaped).toEqual([])
  })

  it('a dep nobody reuses is merged and reaped as before', async () => {
    const { h, merges } = reuseRig({ worktree: 'new' })
    await h.loop.nudge()
    await h.settle()
    expect(merges[0]).toEqual({ root: '/wt1', paths: ['/wt-a'], reap: undefined })
    expect(startOf(h, 'tsk_B')?.worktree).toBe('new')
  })

  it('falls back to a new worktree, with a log line, when the dep folder is gone', async () => {
    const { h, merges } = reuseRig()
    h.ctx.isRegisteredWorktree = () => false
    await h.loop.nudge()
    await h.settle()
    expect(startOf(h, 'tsk_B')?.worktree).toBe('new')
    expect(merges.some((m) => m.root === '/wt-a')).toBe(false)
    expect(h.logs.some((l) => l.includes('task=tsk_B cannot reuse /wt-a: the folder is gone'))).toBe(true)
  })

  it('worker-start refuses a second live implementer in a folder, but not a reviewer there', async () => {
    const h = rig({ concurrency: 3 })
    const live = (id: string, taskId: string, review?: true): Dispatch =>
      ({ id, taskId, provider: 'claude', accountId: 'accA', sessionId: `w-${id}`, cwd: '/wt-x', specPath: '', startedAt: NOW, ...(review ? { review } : {}) }) as Dispatch
    h.setState({ ...h.state(), tasks: [task({ id: 'tsk_1', status: 'reviewing' }), task({ id: 'tsk_2' })], dispatches: [live('dsp_r', 'tsk_1', true)] })
    h.ctx.handle = async () => ({ status: 409, body: {} }) // the loop does not place; the test calls worker-start itself
    const start = () => h.real('worker-start', { task: 'tsk_2', agent: 'claude', account: 'accA', worktree: '/wt-x' })
    expect((await start()).status).toBe(200)
    h.setState({
      ...h.state(),
      tasks: [task({ id: 'tsk_1', status: 'dispatched' }), task({ id: 'tsk_2' })],
      dispatches: [live('dsp_1', 'tsk_1')]
    })
    const refused = await start()
    expect(refused.status).toBe(409)
    expect(JSON.stringify(refused.body)).toContain('/wt-x already has a live worker of task tsk_1')
  })

  // tsk_07e68847dd9f6c07's safe merges: uncommitted work in a finished Task's worktree is never reaped; a merge worker takes it
  it('a dirty Task worktree at its merge is not reaped and goes to the merge worker', async () => {
    const h = rig({ concurrency: 2 })
    h.setState({ ...h.state(), tasks: [task({ id: 'tsk_A', status: 'merging' })], dispatches: [ended('dsp_a', 'tsk_A', '/wt-a')] })
    h.ctx.integrate = async () => ({ kind: 'merged', uncommitted: 2, dirty: ['/wt-a'] })
    await h.loop.nudge()
    await h.settle()
    const s = h.state()
    expect(s.tasks.find((t) => t.id === 'tsk_A')!.status).toBe('merging')
    const merge = s.tasks.find((t) => t.parentId === 'tsk_A')!
    expect(merge.spec).toContain('/wt-a')
    expect(merge.spec).toContain('still holds uncommitted changes')
    expect(startOf(h, merge.id)).toBeDefined()
    expect(h.reaped).toEqual([])
  })
})
