// T8: `runs doctor` finds each kind of mismatch on one fixture and `--fix` repairs each; `sessions close` is the
// owner's, or a coordinator's for its own Run only.
import { describe, it, expect, vi } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { diagnoseRuns, repairFindings, type DoctorFinding } from './runsDoctor'
import { exitWording } from '../sessions/exitWording'
import { t } from '../i18n'
import type { CloseReason } from '../types'
import type { Dispatch, Job, JobRun, Task } from './types'

const NOW = '2026-10-22T00:00:00.000Z'
const LATER = '2026-10-22T01:00:00.000Z'

// job_lost is not app-driven: a lost worker in an app-driven Run is retried by the watchdog, not a doctor finding
const job = (id: string): Job => ({ id, objective: id, cwd: '/p', createdAt: NOW, ...(id === 'job_lost' ? {} : { autoDispatch: true as const }) })
const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, createdAt: NOW, ...over })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id,
  runId,
  title: id,
  spec: '',
  deps: [],
  status: 'completed',
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})
const dispatch = (id: string, taskId: string, over: Partial<Dispatch> = {}): Dispatch => ({
  id,
  taskId,
  sessionId: `ses_${id}`,
  startedAt: NOW,
  provider: 'claude',
  accountId: 'acc',
  cwd: '/p',
  specPath: '',
  workerState: 'ready',
  retained: false,
  ...over
})
const session = (id: string, alive: boolean): HostSession => ({ id, kind: 'terminal', title: null, accountId: null, cwd: null, alive, state: 'unknown' })

/** One Run per mismatch kind:
 *  - run_stall: a failed Task with tries left and no coordinator (stuck: stalled)
 *  - run_rev: a Task reviewing whose reviewer ended, and a Task still at work (so not stuck)
 *  - run_lost: a Task dispatched whose worker ended unreported, no coordinator
 *  - run_dead: an open Dispatch whose session the Host lists as exited
 *  - run_done: finished, with its coordinator session still alive (stray) */
function fixture(): OrchState {
  return {
    ...emptyState(),
    jobs: ['job_stall', 'job_rev', 'job_lost', 'job_dead', 'job_done'].map(job),
    runs: [
      run('run_stall', 'job_stall'),
      run('run_rev', 'job_rev'),
      run('run_lost', 'job_lost'),
      run('run_dead', 'job_dead'),
      run('run_done', 'job_done', { coordinatorSessionId: 'ses_coord_done' })
    ],
    tasks: [
      task('t_fail', 'run_stall', { status: 'failed', consecutiveFailures: 1 }),
      task('t_rev', 'run_rev', { status: 'reviewing' }),
      task('t_busy', 'run_rev', { status: 'ready' }),
      task('t_lost', 'run_lost', { status: 'dispatched' }),
      task('t_dead', 'run_dead', { status: 'dispatched' }),
      task('t_done', 'run_done')
    ],
    dispatches: [
      dispatch('d_work', 't_rev', { outcome: 'succeeded', endedAt: NOW, workerState: 'stopped' }),
      dispatch('d_review', 't_rev', { startedAt: LATER, review: true, endedAt: LATER, workerState: 'stopped' }),
      dispatch('d_lost', 't_lost', { endedAt: NOW, workerState: 'failed' }),
      dispatch('d_dead', 't_dead')
    ]
  }
}
const sessions = [session('ses_d_dead', false), session('ses_coord_done', true)]
const ALL = ['run_stall', 'run_rev', 'run_lost', 'run_dead', 'run_done']

const kinds = (fs: readonly DoctorFinding[]): string[] => fs.map((f) => `${f.kind}:${f.runId}`).sort()

describe('runs doctor — diagnoseRuns', () => {
  it('lists each mismatch kind on a fixture', () => {
    expect(kinds(diagnoseRuns(fixture(), ALL, sessions))).toEqual([
      'dead-dispatch:run_dead',
      'lost-worker:run_lost',
      'stopped-reviewer:run_rev',
      'stray-session:run_done',
      'stuck:run_stall'
    ])
    expect(diagnoseRuns(fixture(), ['run_stall'], sessions)[0]).toMatchObject({ kind: 'stuck', stuck: 'stalled' })
  })

  it('skips the session checks with no session list, and a session the Host does not list is not dead', () => {
    expect(kinds(diagnoseRuns(fixture(), ALL))).toEqual(['lost-worker:run_lost', 'stopped-reviewer:run_rev', 'stuck:run_stall'])
    expect(kinds(diagnoseRuns(fixture(), ['run_dead'], []))).toEqual([])
  })

  it('finds nothing on a healthy Run', () => {
    const s: OrchState = { ...emptyState(), jobs: [job('j')], runs: [run('r', 'j')], tasks: [task('a', 'r', { status: 'ready' })] }
    expect(diagnoseRuns(s, ['r'], [])).toEqual([])
  })
})

describe('runs doctor — T36: a Run stalled on a failed Task', () => {
  const stalled = (): OrchState => ({
    ...emptyState(),
    jobs: [job('j')],
    runs: [run('r', 'j')],
    tasks: [task('f', 'r', { status: 'failed', consecutiveFailures: 1, result: 'made 19 screens' }), task('w', 'r', { status: 'pending', deps: ['f'] })]
  })

  it('reports it once, as stalled with its reason, in place of the generic stuck finding', () => {
    expect(diagnoseRuns(stalled(), ['r'])).toEqual([{ kind: 'stalled', runId: 'r', taskId: 'f', detail: 'stalled: waiting on f (f) (failed): 1 Task(s) wait on it' }])
  })

  it('--fix asks the owner once; a second fix leaves it to the owner', async () => {
    const box = { s: stalled() }
    const ctx = { getState: () => box.s, setState: async (n: OrchState) => void (box.s = n), now: () => LATER, lang: 'en' as const, sessionExited: async () => {} }
    const first = await repairFindings(diagnoseRuns(box.s, ['r']), ctx)
    expect(first[0]).toMatchObject({ fixed: true, did: 'asked the owner about f' })
    expect(box.s.messages.filter((m) => m.type === 'escalation' && m.taskId === 'f')).toHaveLength(1)
    const again = await repairFindings(diagnoseRuns(box.s, ['r']), ctx)
    expect(again[0]).toMatchObject({ fixed: false })
    expect(box.s.messages).toHaveLength(1)
  })
})

// T15: Runs whose Tasks the 2026-10-22 `reset --tasks` wipe removed
describe('runs doctor — a Run whose Tasks are gone', () => {
  const lostState = (): OrchState => ({
    ...emptyState(),
    jobs: [job('j_pr'), job('j_idle')],
    runs: [run('r_pr', 'j_pr', { pr: { at: NOW, url: 'https://github.com/o/r/pull/1' } }), run('r_idle', 'j_idle')]
  })

  it('finds the lost Tasks of a Run with a delivery record, and an empty Run nothing can add Tasks to', () => {
    const found = diagnoseRuns(lostState(), ['r_pr', 'r_idle'])
    expect(kinds(found)).toEqual(['lost-tasks:r_idle', 'lost-tasks:r_pr'])
    expect(found.find((f) => f.runId === 'r_pr')!.detail).toMatch(/lost from the store; it reads completed/)
    expect(found.find((f) => f.runId === 'r_idle')!.detail).toMatch(/nothing can add one.*reads failed/)
  })

  it('flags the lost Tasks to the owner once, keeping every record', async () => {
    const box = { s: lostState() }
    const fix = async () =>
      repairFindings(diagnoseRuns(box.s, ['r_pr']), {
        getState: () => box.s,
        setState: async (next) => {
          box.s = next
        },
        now: () => LATER,
        lang: 'en',
        sessionExited: async () => {}
      })
    const [first] = await fix()
    expect(first).toMatchObject({ fixed: true })
    const flagged = box.s.messages.filter((m) => m.runId === 'r_pr' && m.type === 'escalation')
    expect(flagged).toHaveLength(1)
    expect(box.s.runs).toHaveLength(2)
    // idempotent: a second --fix adds nothing
    const [second] = await fix()
    expect(second).toMatchObject({ fixed: false })
    expect(box.s.messages.filter((m) => m.runId === 'r_pr' && m.type === 'escalation')).toHaveLength(1)
  })
})

describe('runs doctor — repairFindings', () => {
  it('repairs each kind with the repair it already has', async () => {
    const box = { s: fixture() }
    const sessionExited = vi.fn(async () => {})
    const stopSession = vi.fn(async () => {})
    const repairs = await repairFindings(diagnoseRuns(box.s, ALL, sessions), {
      getState: () => box.s,
      setState: async (next) => {
        box.s = next
      },
      now: () => LATER,
      lang: 'en',
      sessionExited,
      stopSession
    })
    expect(repairs.every((r) => r.fixed)).toBe(true)
    const status = (id: string): string | undefined => box.s.tasks.find((t) => t.id === id)?.status
    const gateOn = (id: string): string | undefined => box.s.gates.find((g) => g.taskId === id && g.status === 'open')?.question
    // stalled: a retry Gate, so the Run now needs its owner
    expect(status('t_fail')).toBe('blocked')
    expect(gateOn('t_fail')).toMatch(/failed 1 of 3 times/)
    expect(diagnoseRuns(box.s, ['run_stall'])[0]).toMatchObject({ kind: 'stuck', stuck: 'needs-you' })
    // the stopped reviewer: the restart Gate
    expect(status('t_rev')).toBe('blocked')
    // the lost worker: the lost-worker Gate
    expect(gateOn('t_lost')).toMatch(/was lost \(dispatch d_lost\)/)
    // the dead Dispatch: closed through the session-exit path; the stray session: stopped
    expect(sessionExited).toHaveBeenCalledWith('ses_d_dead')
    expect(stopSession).toHaveBeenCalledWith('ses_coord_done', expect.stringContaining('run_done'))
  })

  it('leaves a needs-you Run to the owner', async () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [job('j')],
      runs: [run('r', 'j')],
      tasks: [task('g', 'r', { status: 'blocked' })],
      gates: [{ id: 'gat', runId: 'r', taskId: 'g', question: 'q', status: 'open', createdAt: NOW }]
    }
    const [repair] = await repairFindings(diagnoseRuns(s, ['r']), { getState: () => s, setState: async () => {}, now: () => NOW, lang: 'en', sessionExited: async () => {} })
    expect(repair).toMatchObject({ fixed: false, finding: { stuck: 'needs-you' } })
  })
})

const makeDeps = (state: OrchState, extra: Partial<OrchServerDeps> = {}): OrchServerDeps & { box: { state: OrchState } } => {
  const box = { state }
  return {
    box,
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 's', cwd: '/p', specPath: 'S' }),
    releaseWorker: async () => {},
    readWorker: async () => '',
    now: () => LATER,
    ...extra
  } as OrchServerDeps & { box: { state: OrchState } }
}

describe('runs doctor — the command', () => {
  it('reports from a shell, and --fix repairs and lists what it did', async () => {
    const deps = makeDeps(fixture(), { listSessions: async () => sessions, stopCoordinator: vi.fn(async () => {}) })
    const r = await handleCommand(deps, { sessionId: '' }, 'runs-doctor', {})
    expect(r.status).toBe(200)
    expect((r.body as { findings: DoctorFinding[] }).findings).toHaveLength(5)
    const fixed = await handleCommand(deps, { sessionId: '' }, 'runs-doctor', { run: 'run_stall', fix: true })
    expect((fixed.body as { repairs: Array<{ fixed: boolean }> }).repairs).toEqual([expect.objectContaining({ fixed: true })])
    expect(deps.box.state.tasks.find((t) => t.id === 't_fail')?.status).toBe('blocked')
  })

  it('lets a coordinator doctor its own Run only', async () => {
    const s = fixture()
    const deps = makeDeps({ ...s, runs: s.runs.map((r) => (r.id === 'run_stall' ? { ...r, coordinatorSessionId: 'ses_c' } : r)) })
    expect((await handleCommand(deps, { sessionId: 'ses_c' }, 'runs-doctor', {})).status).toBe(200)
    expect((await handleCommand(deps, { sessionId: 'ses_c' }, 'runs-doctor', { run: 'run_rev' })).status).toBe(403)
    expect((await handleCommand(deps, { sessionId: 'ses_c' }, 'runs-doctor', { all: true })).status).toBe(403)
    expect((await handleCommand(deps, { sessionId: 'ses_other' }, 'runs-doctor', {})).status).toBe(403)
  })
})

describe('sessions close', () => {
  const state = (): OrchState => ({
    ...emptyState(),
    jobs: [job('job_a'), job('job_b')],
    runs: [run('run_a', 'job_a', { coordinatorSessionId: 'ses_coord_a' }), run('run_b', 'job_b', { coordinatorSessionId: 'ses_coord_b' })],
    tasks: [task('ta', 'run_a', { status: 'reviewing' }), task('tb', 'run_b', { status: 'ready' })],
    dispatches: [dispatch('rev_a', 'ta', { sessionId: 'ses_rev_a', review: true, outcome: 'succeeded', endedAt: NOW })]
  })
  const live = async (): Promise<HostSession[]> => ['ses_rev_a', 'ses_coord_a', 'ses_coord_b', 'ses_x'].map((id) => session(id, true))

  it('the owner closes a session, and its tab says Astera closed it on request', async () => {
    const stopCoordinator = vi.fn(async () => {})
    const deps = makeDeps(state(), { stopCoordinator, listSessions: live })
    const r = await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_x', reason: 'left over from yesterday' })
    expect(r.status).toBe(200)
    expect(stopCoordinator).toHaveBeenCalledWith('ses_x', 'left over from yesterday', 'closed:left over from yesterday')
    // the close reason the stop carries is what the tab's exit line reads (pty-kill → pty-exit → session:exit)
    const closeReason = (stopCoordinator.mock.calls[0] as unknown[])[2] as CloseReason
    for (const code of [129, 143]) {
      const w = exitWording(code, { closedByAstera: true, closeReason })
      expect(w.tone).toBe('muted')
      expect(t('en', w.key, w.params)).toBe('Closed by Astera — left over from yesterday')
    }
  })

  it('a close with no --reason says so in the tab, and a long or multi-line reason is one short line', async () => {
    const stopCoordinator = vi.fn(async () => {})
    const deps = makeDeps(state(), { stopCoordinator, listSessions: live })
    await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_x' })
    expect(stopCoordinator).toHaveBeenLastCalledWith('ses_x', 'closed with astera sessions close', 'closed:closed with astera sessions close')
    await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_x', reason: `a\n  b ${'x'.repeat(300)}` })
    const sent = (stopCoordinator.mock.calls.at(-1) as unknown[])[2] as string
    expect(sent.startsWith('closed:a b x')).toBe(true)
    expect(sent.length).toBe('closed:'.length + 200)
  })

  it('a coordinator closes its own Run’s session, and is refused another Run’s', async () => {
    const stopCoordinator = vi.fn(async () => {})
    const deps = makeDeps(state(), { stopCoordinator, listSessions: live })
    expect((await handleCommand(deps, { sessionId: 'ses_coord_a' }, 'sessions-close', { id: 'ses_rev_a' })).status).toBe(200)
    const refused = await handleCommand(deps, { sessionId: 'ses_coord_b' }, 'sessions-close', { id: 'ses_rev_a' })
    expect(refused.status).toBe(403)
    expect((await handleCommand(deps, { sessionId: 'ses_coord_b' }, 'sessions-close', { id: 'ses_x' })).status).toBe(403)
    expect(stopCoordinator).toHaveBeenCalledTimes(1)
  })

  it('refuses a worker with an open Dispatch, and says when a session is unknown or already ended', async () => {
    const s = state()
    const deps = makeDeps(
      { ...s, tasks: [...s.tasks, task('tw', 'run_a', { status: 'dispatched' })], dispatches: [...s.dispatches, dispatch('dw', 'tw', { sessionId: 'ses_w' })] },
      { stopCoordinator: vi.fn(async () => {}), listSessions: async () => [...(await live()), session('ses_gone', false)] }
    )
    expect((await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_w' })).status).toBe(409)
    expect((await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_none' })).status).toBe(404)
    expect((await handleCommand(deps, { sessionId: '' }, 'sessions-close', { id: 'ses_gone' })).body).toMatchObject({ alreadyEnded: true })
  })
})
