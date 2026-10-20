// W7-A talk to the planner through the real command layer: feedback before approval (typed, resumed, fresh), the
// planner's revision and report, feedback while the plan runs (a W6-D replan at once), rejection, and auto-approve.
import { describe, it, expect } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import { planIncompleteActivity, planReadyActivity } from '../../../host/activity'
import { snapshotFor } from '../view'
import { buildPlannerBrief } from '../handover'
import type { Task } from '../types'
import { KEEP_THE_PLAN, autoApproveOf, awaitsGo, feedbackLine, freshFeedbackBrief, handsOffOf, plansMissingReady, resumeBrief } from './plannerFeedback'

const NOW = '2026-10-18T00:00:00.000Z'

const rig = (o: { alive?: boolean; agent?: string | null; prompt?: 'permission' | null } = {}) => {
  let state: OrchState = emptyState()
  let planners = 0
  const starts: Array<Record<string, unknown>> = []
  const stopped: string[] = []
  const typed: Array<{ id: string; text: string }> = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => ({ sessionId: 'ses-worker', cwd: '/repo', specPath: '/s.md' }),
    startCoordinator: async (a: Record<string, unknown>) => {
      starts.push(a)
      return { sessionId: a.role === 'planner' ? `ses-planner-${++planners}` : 'ses-coordinator' }
    },
    stopCoordinator: async (sessionId: string) => {
      stopped.push(sessionId)
    },
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    listSessions: async (): Promise<HostSession[]> =>
      Array.from({ length: planners }, (_, i) => ({
        id: `ses-planner-${i + 1}`,
        kind: 'terminal',
        title: null,
        accountId: 'acc1',
        cwd: '/repo',
        // a stopped planner is gone, as the Host's own listing says
        alive: (o.alive ?? true) && !stopped.includes(`ses-planner-${i + 1}`),
        state: o.prompt ? 'waiting' : 'unknown'
      })) as HostSession[],
    sendSession: async (id: string, text: string) => {
      typed.push({ id, text })
    },
    sessionTurn: async () => ({ alive: true, state: o.prompt ? 'waiting' : 'unknown', prompt: o.prompt ?? null }),
    agentSessionOf: async () => (o.agent === undefined ? 'claude-conv-1' : o.agent),
    now: () => NOW
  } as unknown as OrchServerDeps
  const as = (sessionId: string) => (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, cmd, args)
  return { deps, starts, stopped, typed, person: as(''), as, state: () => state, set: (s: OrchState) => (state = s) }
}
type Rig = ReturnType<typeof rig>

const plan = (title: string, extra: Record<string, unknown> = {}) => ({
  account: 'acc1',
  title,
  spec: `the ${title} part`,
  prompt: `Build ${title}.`,
  criteria: [`${title} works`],
  affectedPaths: [`src/${title}.ts`],
  basis: 'missing',
  evidence: `no ${title} in src/`,
  ...extra
})

/** A planned Job with A ← B, waiting for approval. */
const planned = async (r: Rig, job: Record<string, unknown> = {}) => {
  const made = await r.person('run-create', { objective: 'ship it', cwd: '/repo', coordinatorAccount: 'acc1', auto: true, ...job })
  const jobId = (made.body as { id: string }).id
  expect((await r.person('jobs-plan', { id: jobId })).status).toBe(200)
  const planner = r.as('ses-planner-1')
  const a = (await planner('task-create', { run: jobId, ...plan('A') })).body as Task
  const b = (await planner('task-create', { run: jobId, ...plan('B', { deps: [a.id] }) })).body as Task
  return { jobId, a, b }
}

describe('feedback before approval', () => {
  it('types the feedback into the live planner and records it', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'T2 is too big,\nsplit it' })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ via: 'typed', sessionId: 'ses-planner-1' })
    expect(r.typed).toEqual([{ id: 'ses-planner-1', text: feedbackLine(jobId, 'T2 is too big,\nsplit it') }])
    expect(r.typed[0].text).not.toContain('\n')
    expect(r.state().jobs[0].feedback).toEqual([{ at: NOW, text: 'T2 is too big,\nsplit it', phase: 'plan' }])
  })

  it('#116: a feedback round is planning again: the plan is not ready until the planner ends its turn', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await r.person('jobs-plan-ready', { id: jobId })).status).toBe(200)
    expect(r.state().jobs[0].planReadyAt).toBe(NOW)
    expect((await r.person('jobs-feedback', { job: jobId, text: 'split B' })).status).toBe(200)
    expect(r.state().jobs[0]).not.toHaveProperty('planReadyAt')
  })

  it('refuses while the planner waits on a permission prompt: typing would answer it', async () => {
    const r = rig({ prompt: 'permission' })
    const { jobId } = await planned(r)
    expect((await r.person('jobs-feedback', { job: jobId, text: 'x' })).status).toBe(409)
    expect(r.typed).toEqual([])
    expect(r.state().jobs[0].feedback).toBeUndefined()
  })

  it('resumes the planner conversation when its session has ended', async () => {
    const r = rig({ alive: false })
    const { jobId } = await planned(r)
    const reply = await r.person('jobs-feedback', { job: jobId, text: "don't touch auth" })
    expect(reply.body).toMatchObject({ via: 'resumed', sessionId: 'ses-planner-2' })
    expect(r.starts.at(-1)).toMatchObject({ role: 'planner', resume: 'claude-conv-1', runId: jobId })
    expect(r.starts.at(-1)!.brief).toContain("don't touch auth")
    expect(r.state().jobs[0].plannerSessionIds).toEqual(['ses-planner-1', 'ses-planner-2'])
  })

  it('starts a fresh planner with the plan and the whole history when nothing can be resumed', async () => {
    const r = rig({ alive: false, agent: null })
    const { jobId } = await planned(r)
    await r.person('jobs-feedback', { job: jobId, text: 'first' })
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'second' })
    expect(reply.body).toMatchObject({ via: 'fresh' })
    const brief = r.starts.at(-1)!.brief as string
    expect(r.starts.at(-1)!.resume).toBeUndefined()
    expect(brief).toContain(`plans/${jobId}/plan.md`)
    expect(brief).toContain('existing.md')
    expect(brief).toMatch(/1\. first[\s\S]*2\. second/)
  })

  it('lets the planner revise: cancel a Task of its plan, then report its changes', async () => {
    const r = rig()
    const { jobId, a, b } = await planned(r)
    await r.person('jobs-feedback', { job: jobId, text: 'drop A' })
    const planner = r.as('ses-planner-1')
    // B depends on A: the cancel is refused until B's deps change
    expect((await planner('task-cancel', { id: a.id, reason: 'owner' })).status).toBe(400)
    expect((await planner('task-update', { id: b.id, deps: [] })).status).toBe(200)
    expect((await planner('task-cancel', { id: a.id, reason: 'owner' })).status).toBe(200)
    expect(r.state().tasks.map((t) => t.id)).toEqual([b.id])
    expect((await planner('jobs-feedback-done', { id: jobId, changes: ['Dropped A', ' '] })).status).toBe(200)
    expect(r.state().jobs[0].feedback![0].changes).toEqual(['Dropped A'])
    // A second report has no open round
    expect((await planner('jobs-feedback-done', { id: jobId, changes: [] })).status).toBe(409)
    // The plan is ready again, once for this round, with the changes and the chime
    const ready = planReadyActivity(r.state(), 'ses-planner-1', () => [])!
    expect(ready.payload).toMatchObject({ round: 1, changes: ['Dropped A'] })
    const held = [{ ...ready, id: 'e1', sequence: 1, occurredAt: NOW }] as ActivityEvent[]
    expect(planReadyActivity(r.state(), 'ses-planner-1', () => held)).toBeNull()
    expect(noticeOf(held[0])).toMatchObject({ key: `approve:${jobId}:1`, alert: true })
  })

  it('refuses the commands to agents, and the planner the owner\'s commands', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    for (const cmd of ['jobs-feedback', 'jobs-reject'])
      expect((await r.as('ses-planner-1')(cmd, { job: jobId, text: 'x' })).status).toBe(403)
    expect((await r.as('ses-other')('jobs-feedback', { job: jobId, text: 'x' })).status).toBe(403)
    expect((await r.as('ses-other')('jobs-feedback-done', { id: jobId, changes: [] })).status).toBe(403)
  })
})

describe('reject', () => {
  it('archives the plan with the reason and ends its planner', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    const reply = await r.person('jobs-reject', { job: jobId, reason: 'wrong approach' })
    expect(reply.status).toBe(200)
    const job = r.state().jobs[0]
    expect(job.archivedAt).toBe(NOW)
    expect(job.rejected).toEqual({ at: NOW, reason: 'wrong approach' })
    expect(r.stopped).toEqual(['ses-planner-1'])
    expect(r.state().runs).toEqual([])
    // Undo is the existing unarchive
    expect((await r.person('jobs-unarchive', { id: jobId })).status).toBe(200)
    expect(r.state().jobs[0].archivedAt).toBeUndefined()
  })
})

describe('feedback while the plan runs', () => {
  it('starts a W6-D replan at once, with the feedback in its brief, and records its summary as the change', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'you missed the mobile view' })
    expect(reply.status).toBe(200)
    const job = r.state().jobs[0]
    expect(job.dispatchHold).toBe(true)
    expect(job.replanning).toMatchObject({ mode: 'wave', wave: 0, feedbackAt: NOW })
    expect(job.feedback).toEqual([{ at: NOW, text: 'you missed the mobile view', phase: 'run' }])
    const brief = r.starts.at(-1)!.brief as string
    expect(brief).toContain('OWNER FEEDBACK')
    expect(brief).toContain('you missed the mobile view')
    const sid = (reply.body as { sessionId: string }).sessionId
    expect((await r.as(sid)('jobs-replan-done', { id: jobId, summary: 'added a mobile Task' })).status).toBe(200)
    const after = r.state().jobs[0]
    expect(after.replanning).toBeUndefined()
    expect(after.dispatchHold).toBeUndefined()
    expect(after.feedback![0].changes).toEqual(['no change: added a mobile Task'])
  })

  it('refuses a plan that is not running', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'o', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    expect((await r.person('jobs-feedback', { job: (made.body as { id: string }).id, text: 'x' })).status).toBe(409)
  })
})

describe('auto-approve', () => {
  it('reads the Job before its project, and defaults to off', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    const s = r.state()
    const job = s.jobs[0]
    expect(autoApproveOf(s, job)).toBe(false)
    expect((await r.person('jobs-auto-start', { id: jobId })).status).toBe(409)
    const projectId = s.projects[0]?.id
    if (projectId) {
      expect((await r.person('projects-set', { id: projectId, autoApprove: 'on' })).status).toBe(200)
      expect(autoApproveOf(r.state(), r.state().jobs[0])).toBe(true)
    }
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, autoApprove: false })) })
    expect(autoApproveOf(r.state(), r.state().jobs[0])).toBe(false)
  })

  it('starts a plan that holds at once, ends its planner, and says so in the feed', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, autoApprove: true })) })
    const before = r.state()
    const reply = await r.as('')('jobs-auto-start', { id: jobId })
    expect(reply).toMatchObject({ status: 200, body: { jobId, tasks: 2 } })
    const job = r.state().jobs[0]
    expect(job.pendingStart).toBeUndefined()
    expect(job.autoStartedAt).toBe(NOW)
    expect(r.stopped).toContain('ses-planner-1')
    const line = deriveActivity(before, r.state()).find((d) => d.type === 'plan.auto-started')!
    expect(line.payload.tasks).toBe(2)
    expect(noticeOf({ ...line, id: 'e', sequence: 1, occurredAt: NOW } as ActivityEvent)).toMatchObject({ title: 'Plan started: 2 tasks' })
    // An agent can never start one
    expect((await r.as('ses-planner-1')('jobs-auto-start', { id: jobId })).status).toBe(403)
  })

  it('#117: a hands-off plan records its start as an approval decision; an auto-approve one records none', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, handsOff: true })) })
    const before = r.state()
    expect((await r.as('')('jobs-auto-start', { id: jobId })).status).toBe(200)
    expect(r.state().jobs[0].decisions).toEqual([{ at: NOW, kind: 'approval', question: 'Start the plan?', choice: 'started', why: 'the plan holds (2 tasks) and runs hands-off' }])
    expect(deriveActivity(before, r.state()).map((d) => d.type)).toContain('plan.decided')
    const plain = rig()
    const second = await planned(plain)
    plain.set({ ...plain.state(), jobs: plain.state().jobs.map((j) => ({ ...j, autoApprove: true })) })
    await plain.as('')('jobs-auto-start', { id: second.jobId })
    expect(plain.state().jobs[0].decisions).toBeUndefined()
  })

  it('jobs-plan --auto-approve sets the Job override', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'o', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const id = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id, autoApprove: 'maybe' })).status).toBe(400)
    expect((await r.person('jobs-plan', { id, autoApprove: 'on' })).status).toBe(200)
    expect(r.state().jobs[0].autoApprove).toBe(true)
  })
})

describe('#117 hands-off', () => {
  const withProject = (s: OrchState, handsOff?: boolean): OrchState => ({
    ...s,
    projects: [{ id: 'prj_1', path: '/repo', name: 'repo', addedAt: NOW, ...(handsOff !== undefined ? { handsOff } : {}) }],
    jobs: s.jobs.map((j) => ({ ...j, projectId: 'prj_1' }))
  })

  it('handsOffOf reads the Job before its project, and defaults to off; autoApproveOf is true when hands-off', async () => {
    const r = rig()
    await planned(r)
    const base = withProject(r.state())
    expect(handsOffOf(base, base.jobs[0])).toBe(false)
    expect(autoApproveOf(base, base.jobs[0])).toBe(false)
    const project = withProject(r.state(), true)
    expect(handsOffOf(project, project.jobs[0])).toBe(true)
    expect(autoApproveOf(project, project.jobs[0])).toBe(true)
    // The Job's own off wins over its project's on, and its own on wins over an auto-approve off
    const off = { ...project.jobs[0], handsOff: false }
    expect(handsOffOf(project, off)).toBe(false)
    const on = { ...base.jobs[0], handsOff: true, autoApprove: false }
    expect(handsOffOf(base, on)).toBe(true)
    expect(autoApproveOf(base, on)).toBe(true)
  })
})

describe('#116 fold-in: plans waiting from before planReadyAt', () => {
  it('lists a waiting plan that holds and whose planner is gone; never one whose planner runs, or that does not hold', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect(r.state().jobs[0].planReadyAt).toBeUndefined()
    expect(plansMissingReady(r.state(), new Set())).toEqual([jobId])
    expect(plansMissingReady(r.state(), new Set(['ses-planner-1']))).toEqual([])
    // Already marked: nothing to do
    const marked = { ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, planReadyAt: NOW })) }
    expect(plansMissingReady(marked, new Set())).toEqual([])
    // A plan that does not hold (a Task without a prompt) is left for its planner
    const broken = { ...r.state(), tasks: r.state().tasks.map((t) => ({ ...t, prompt: undefined })) }
    expect(plansMissingReady(broken, new Set())).toEqual([])
  })
})

// W8-F (#93): the app's box reaches the Host's command layer, which has the planner's session. The route is
// main/remote/orchRouter.ts (HOST_ANSWERED, its test); here, the Host's answer to the same call, live and ended.
describe('W8-F (#93) the app\'s call answers typed for a live planner and resumed for an ended one', () => {
  const asApp = (r: Rig, args: Record<string, unknown>) => handleCommand(r.deps, { sessionId: '', role: 'app' }, 'jobs-feedback', args)

  it('typed while the planner lives', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await asApp(r, { job: jobId, text: 'round one' })).body).toMatchObject({ via: 'typed', sessionId: 'ses-planner-1' })
    expect(r.starts.filter((x) => x.role === 'planner')).toHaveLength(1)
  })

  it('resumed once it has ended', async () => {
    const r = rig({ alive: false })
    const { jobId } = await planned(r)
    expect((await asApp(r, { job: jobId, text: 'round two' })).body).toMatchObject({ via: 'resumed' })
    expect(r.starts.at(-1)).toMatchObject({ resume: 'claude-conv-1' })
  })
})

describe('W8-F (#94) a plan the feedback left without a basis', () => {
  it('every way the feedback reaches the planner asks for --basis and --evidence', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    const job = r.state().jobs[0]
    for (const text of [feedbackLine(jobId, 'add P7'), resumeBrief(jobId, 'add P7'), freshFeedbackBrief(job, 'acc1', [{ at: NOW, text: 'add P7', phase: 'plan' }])]) {
      expect(text).toContain('--basis missing|partial|broken')
      expect(text).toContain('--evidence')
    }
    expect(buildPlannerBrief({ jobId, objective: 'o', repoRoot: '/repo', accountId: 'acc1', concurrency: 2 })).toContain('--basis')
  })

  it('says what is missing instead of "ready for approval", once per round, until the plan holds', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    await r.person('jobs-feedback', { job: jobId, text: 'add one more Task P7' })
    const added = (await r.as('ses-planner-1')('task-create', { run: jobId, ...plan('P7', { basis: undefined, evidence: undefined }) })).body as Task
    await r.as('ses-planner-1')('jobs-feedback-done', { id: jobId, changes: ['added P7'] })
    expect(planReadyActivity(r.state(), 'ses-planner-1', () => [])).toBeNull()
    const line = planIncompleteActivity(r.state(), 'ses-planner-1', () => [])!
    expect(line.type).toBe('plan.incomplete')
    expect(line.payload.problems?.join(' ')).toContain('has no basis')
    // the Run window reads the same problems before Run is pressed
    const row = snapshotFor(r.state(), '/repo', () => true, [], () => null, () => true).runs.find((x) => x.id === jobId)!
    expect(row.planProblems?.join(' ')).toContain(`${added.id} (P7) has no basis`)
    // once per round
    expect(planIncompleteActivity(r.state(), 'ses-planner-1', () => [{ ...line, id: 'e', sequence: 1, occurredAt: NOW } as ActivityEvent])).toBeNull()
    // the planner fixes it: no incomplete line, the ready line comes, and the row has no problems
    await r.as('ses-planner-1')('task-update', { id: added.id, basis: 'missing', evidence: 'no P7 in src/' })
    expect(planIncompleteActivity(r.state(), 'ses-planner-1', () => [])).toBeNull()
    expect(planReadyActivity(r.state(), 'ses-planner-1', () => [])).not.toBeNull()
    expect(snapshotFor(r.state(), '/repo', () => true, [], () => null, () => true).runs.find((x) => x.id === jobId)?.planProblems).toBeUndefined()
  })
})

describe('T10 plan together', () => {
  /** A Job planned with the owner (`--planning chat`), A ← B written, not started. */
  const together = async (r: Rig, planning: 'chat' | 'auto' = 'chat') => {
    const made = await r.person('run-create', { objective: 'ship it', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id: jobId, planning })).status).toBe(200)
    const planner = r.as('ses-planner-1')
    const a = (await planner('task-create', { run: jobId, ...plan('A') })).body as Task
    const b = (await planner('task-create', { run: jobId, ...plan('B', { deps: [a.id] }) })).body as Task
    return { jobId, a, b, planner }
  }
  /** Each Task as a message must leave it: id, spec, prompt, criteria, status. */
  const kept = (s: OrchState) => s.tasks.map((t) => ({ id: t.id, spec: t.spec, prompt: t.prompt, criteria: t.acceptanceCriteria, status: t.status }))

  it('tells the planner to wait for go, and is not ready at its turn ends, nor started by itself', async () => {
    const r = rig()
    const { jobId } = await together(r)
    expect(r.starts[0].brief).toContain(`astera jobs-plan-ready --id ${jobId}`)
    const s = r.state()
    expect(awaitsGo(s, s.jobs[0])).toBe(true)
    // the Host's turn-end mark and auto-start both leave it alone, also with auto-approve on
    expect(planReadyActivity(s, 'ses-planner-1', () => [])).toBeNull()
    expect((await r.person('jobs-plan-ready', { id: jobId })).status).toBe(409)
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, autoApprove: true })) })
    expect((await r.person('jobs-auto-start', { id: jobId })).status).toBe(409)
    expect(r.state().jobs[0].pendingStart).toBe(true)
    // the row offers Start as soon as the plan holds: the owner's click is their go
    const row = snapshotFor(r.state(), '/repo', () => true, [], () => null, () => true).runs.find((x) => x.id === jobId)!
    expect(row.awaitsGo).toBe(true)
  })

  it("starts on the owner's go, handed on by its planner, and keeps the planner as their chat", async () => {
    const r = rig()
    const { jobId, planner } = await together(r)
    const go = await planner('jobs-plan-ready', { id: jobId })
    expect(go).toMatchObject({ status: 200, body: { jobId, started: true } })
    expect(r.state().jobs[0].pendingStart).toBeFalsy()
    expect(r.state().runs.filter((x) => x.jobId === jobId)).toHaveLength(1)
    expect(r.stopped).not.toContain('ses-planner-1')
    // no second go
    expect((await planner('jobs-plan-ready', { id: jobId })).status).toBe(403)
  })

  it('a planner of another Job, or of an auto plan, cannot start it', async () => {
    const r = rig()
    const { jobId, planner } = await together(r, 'auto')
    expect((await planner('jobs-plan-ready', { id: jobId })).status).toBe(403)
    expect((await r.as('ses-other')('jobs-plan-ready', { id: jobId })).status).toBe(403)
    // an auto plan is marked ready at its turn's end as before
    expect((await r.person('jobs-plan-ready', { id: jobId })).status).toBe(200)
  })

  it('a message changes only what it names: every other Task keeps its id, spec and status, typed, resumed or fresh', async () => {
    for (const o of [{}, { alive: false }, { alive: false, agent: null }]) {
      const r = rig(o)
      const { jobId } = await together(r)
      const before = kept(r.state())
      const reply = await r.person('jobs-feedback', { job: jobId, text: 'add a Task for the mobile view' })
      expect(reply.status).toBe(200)
      // delivering the message rewrites nothing; only the planner's own edits do, one Task at a time
      expect(kept(r.state())).toEqual(before)
      const said = (reply.body as { via: string }).via === 'typed' ? r.typed.at(-1)!.text : (r.starts.at(-1)!.brief as string)
      expect(said).toContain(KEEP_THE_PLAN)
    }
    const fresh = rig({ alive: false, agent: null })
    const { jobId } = await together(fresh)
    await fresh.person('jobs-feedback', { job: jobId, text: 'add P7' })
    const brief = fresh.starts.at(-1)!.brief as string
    // the rule comes before the planner's brief tells it how to write a plan
    expect(brief.indexOf('THIS IS A REVISION')).toBeLessThan(brief.indexOf('WRITE THE PLAN AS TASKS'))
    expect(brief).toContain('jobs-plan-ready')
  })

  it('while it runs a message reaches the same planner and changes only what has not started', async () => {
    const r = rig()
    const { jobId, planner } = await together(r)
    expect((await planner('jobs-plan-ready', { id: jobId })).status).toBe(200)
    const runId = r.state().runs[0].id
    const runTask = (title: string) => r.state().tasks.find((t) => t.runId === runId && t.title === title)!
    r.set({ ...r.state(), tasks: r.state().tasks.map((t) => (t.id === runTask('A').id ? { ...t, status: 'completed' as const, result: 'built A' } : t)) })
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'also cover the mobile view' })
    expect(reply.body).toMatchObject({ sessionId: 'ses-planner-1', via: 'typed' })
    expect(r.starts.filter((x) => x.role === 'planner')).toHaveLength(1)
    const line = r.typed.at(-1)!.text
    expect(line).toContain('also cover the mobile view')
    expect(line).toContain('Change only what this message is about')
    expect(r.state().jobs[0].replanning).toMatchObject({ sessionId: 'ses-planner-1' })
    // the completed Task is never rewritten; the not-started one may be
    expect((await planner('task-update', { id: runTask('A').id, title: 'A2' })).status).toBe(403)
    const b = runTask('B').id
    expect((await planner('task-update', { id: b, criteria: ['B works on mobile'] })).status).toBe(200)
    const before = r.state()
    expect((await planner('jobs-replan-done', { id: jobId, summary: 'mobile', changes: [`changed ${b} criteria because the owner asked for mobile`] })).status).toBe(200)
    expect(r.state().jobs[0].feedback!.at(-1)!.changes).toEqual([`changed ${b} criteria because the owner asked for mobile`])
    expect(deriveActivity(before, r.state()).filter((e) => e.type === 'plan.changed')).toHaveLength(1)
    expect(r.stopped).not.toContain('ses-planner-1')
    // never for another Job, nor without the owner's words
    expect((await planner('jobs-replan', { id: 'job_other', feedback: 'x' })).status).toBe(403)
    expect((await planner('jobs-replan', { id: jobId })).status).toBe(403)
    // what the owner says in the planner's own terminal: the planner holds the plan itself and becomes the replan
    const own = await planner('jobs-replan', { id: jobId, feedback: 'and a dark mode' })
    expect(own.status).toBe(200)
    expect((own.body as { brief: string }).brief).toContain('and a dark mode')
    expect(r.state().jobs[0].replanning).toMatchObject({ sessionId: 'ses-planner-1', feedbackAt: NOW })
    expect(r.state().jobs[0].feedback!.at(-1)).toMatchObject({ text: 'and a dark mode', phase: 'run' })
    expect(r.typed).toHaveLength(1)
  })

  it('while it runs a planner that is gone is resumed, and only then started fresh', async () => {
    for (const [o, via] of [[{ alive: false }, 'resumed'], [{ alive: false, agent: null }, 'fresh']] as const) {
      const r = rig(o)
      const { jobId, planner } = await together(r)
      expect((await planner('jobs-plan-ready', { id: jobId })).status).toBe(200)
      const reply = await r.person('jobs-feedback', { job: jobId, text: 'one more thing' })
      expect(reply.body).toMatchObject({ via })
      expect(r.starts.at(-1)!.brief).toContain('one more thing')
      if (via === 'resumed') expect(r.starts.at(-1)).toMatchObject({ resume: 'claude-conv-1' })
    }
  })
})
