// W7-A talk to the planner through the real command layer: feedback before approval (typed, resumed, fresh), the
// planner's revision and report, feedback while the plan runs (a W6-D replan at once), rejection, and auto-approve.
import { describe, it, expect } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import { planReadyActivity } from '../../../host/activity'
import type { Task } from '../types'
import { autoApproveOf, feedbackLine } from './plannerFeedback'

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
        alive: o.alive ?? true,
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

  it('jobs-plan --auto-approve sets the Job override', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'o', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const id = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id, autoApprove: 'maybe' })).status).toBe(400)
    expect((await r.person('jobs-plan', { id, autoApprove: 'on' })).status).toBe(200)
    expect(r.state().jobs[0].autoApprove).toBe(true)
  })
})
