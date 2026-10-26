// W7-A talk to the planner through the real command layer: feedback before approval (typed, resumed, fresh), the
// planner's revision and report, feedback while the plan runs (a W6-D replan at once), rejection, and auto-approve.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import { planIncompleteActivity, planReadyActivity } from '../../../host/activity'
import { snapshotFor } from '../view'
import { outcomeOf } from '../running'
import { buildPlannerBrief } from '../handover'
import type { Job, Project, Task } from '../types'
import { approvalOf, autoApproveOf, plannerProblemsNotice, feedbackLine, freshFeedbackBrief, handsOffOf, plansMissingReady, resumeBrief, sendsForOwner } from './plannerFeedback'

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

describe('T2 the console and a plan\'s own chat send jobs-feedback for the owner', () => {
  const row = (id: string, rolledFrom?: string): HostSession =>
    ({ id, kind: 'chat', title: null, accountId: 'acc1', cwd: '/repo', alive: true, state: 'unknown', ...(rolledFrom ? { rolledFrom } : {}) }) as HostSession
  const sessions = [row('ses-console'), row('ses-console-2', 'ses-console'), row('ses-chat'), row('ses-chat-2', 'ses-chat'), row('ses-other-chat')]
  const job = { chatSessionId: 'ses-chat' }

  it.each([
    ['the console', { sessionId: 'ses-console' }, true],
    ['the console after an account roll', { sessionId: 'ses-console-2' }, true],
    ["the plan's own chat", { sessionId: 'ses-chat' }, true],
    ["the plan's own chat after an account roll", { sessionId: 'ses-chat-2' }, true],
    ["another plan's chat", { sessionId: 'ses-other-chat' }, false],
    ['a worker', { sessionId: 'ses-worker' }, false],
    ['a planner', { sessionId: 'ses-planner-1' }, false],
    ['an MCP client', { sessionId: '', role: 'mcp' as const }, false],
    ['an MCP client naming the console', { sessionId: 'ses-console', role: 'mcp' as const }, false]
  ])('%s: %s', (_who, caller, expected) => {
    expect(sendsForOwner(caller, job, 'ses-console', sessions)).toBe(expected)
  })

  it('no console and no chat: nobody', () => {
    expect(sendsForOwner({ sessionId: 'ses-console' }, {}, null, sessions)).toBe(false)
  })

  it('through the command layer: only jobs-feedback, only for the own plan', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'owner-proxy-'))
    try {
      writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ sessionId: 'ses-console' }))
      const r = rig()
      ;(r.deps as { profileDir?: string }).profileDir = dir
      const { jobId } = await planned(r)
      const other: Job = { id: 'job_other', objective: 'other', cwd: '/repo', createdAt: NOW, chatSessionId: 'ses-other-chat' }
      r.set({ ...r.state(), jobs: [...r.state().jobs.map((j) => (j.id === jobId ? { ...j, chatSessionId: 'ses-chat' } : j)), other] })
      expect((await r.as('ses-console')('jobs-feedback', { job: jobId, text: 'add a README' })).status).toBe(200)
      expect((await r.as('ses-chat')('jobs-feedback', { job: jobId, text: 'and tests' })).status).toBe(200)
      expect((await r.as('ses-other-chat')('jobs-feedback', { job: jobId, text: 'x' })).status).toBe(403)
      for (const who of ['ses-console', 'ses-chat']) {
        expect((await r.as(who)('jobs-reject', { job: jobId })).status).toBe(403)
        expect((await r.as(who)('jobs-chat', { id: jobId })).status).toBe(403)
        expect((await r.as(who)('jobs-auto-start', { id: jobId })).status).toBe(403)
      }
      expect(r.state().jobs.find((j) => j.id === jobId)?.feedback?.map((f) => f.text)).toEqual(['add a README', 'and tests'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

describe('approval setting: plan, then project, then global default, then planning mode', () => {
  const job = (over: Partial<Job> = {}): Job => ({ id: 'j', objective: 'o', title: 't', cwd: '/p', createdAt: NOW, projectId: 'prj', ...over })
  const state = (project: Partial<Project> = {}): OrchState => ({ ...emptyState(), projects: [{ id: 'prj', name: 'p', path: '/p', createdAt: NOW, ...project } as Project] })

  it('chat mode asks, auto mode starts when the plan holds', () => {
    expect(approvalOf(state(), job())).toBe('ask')
    expect(approvalOf(state(), job({ planning: 'chat' }))).toBe('ask')
    expect(approvalOf(state(), job({ planning: 'auto' }))).toBe('start')
    expect(autoApproveOf(state(), job({ planning: 'auto' }))).toBe(true)
  })

  it('the plan beats its project, the project beats the global default, the global default beats the planning mode', () => {
    expect(approvalOf(state({ autoApprove: true }), job({ autoApprove: false }))).toBe('ask')
    expect(approvalOf(state({ autoApprove: false }), job({ planning: 'auto' }), 'start')).toBe('ask')
    expect(approvalOf(state({ autoApprove: true }), job(), 'ask')).toBe('start')
    expect(approvalOf(state(), job({ planning: 'auto' }), 'ask')).toBe('ask')
    expect(approvalOf(state(), job(), 'start')).toBe('start')
    expect(approvalOf(state(), job(), 'hands-off')).toBe('hands-off')
  })

  it('hands-off of the plan or its project keeps winning', () => {
    expect(approvalOf(state({ handsOff: true }), job({ autoApprove: false }), 'ask')).toBe('hands-off')
    expect(approvalOf(state(), job({ handsOff: true }))).toBe('hands-off')
  })

  it('jobs-auto-start takes the Host\'s global default (--approval) and refuses without one', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await r.person('jobs-auto-start', { id: jobId })).status).toBe(409)
    expect((await r.person('jobs-auto-start', { id: jobId, approval: 'start' })).status).toBe(200)
  })

  it('projects-set --approval keeps ask apart from unset', async () => {
    const r = rig()
    await planned(r)
    const id = r.state().projects[0]?.id
    if (!id) return
    for (const [approval, autoApprove, handsOff] of [['ask', false, undefined], ['start', true, undefined], ['hands-off', true, true]] as const) {
      expect((await r.person('projects-set', { id, approval })).status).toBe(200)
      expect(r.state().projects[0]).toMatchObject({ autoApprove, ...(handsOff ? { handsOff } : {}) })
    }
    expect((await r.person('projects-set', { id, approval: 'maybe' })).status).toBeGreaterThanOrEqual(400)
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

describe('T1 feedback is never dropped', () => {
  /** A running plan with a feedback replan in flight on ses-planner-2. */
  const replanning = async (r: Rig) => {
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    expect((await r.person('jobs-feedback', { job: jobId, text: 'first' })).status).toBe(200)
    expect(r.state().jobs[0].replanning?.sessionId).toBe('ses-planner-2')
    return jobId
  }

  it('types feedback sent during a replan into its live planner, and records the replan summary as its change', async () => {
    const r = rig()
    const jobId = await replanning(r)
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'also the tablet view' })
    expect(reply).toMatchObject({ status: 200, body: { sessionId: 'ses-planner-2', via: 'typed' } })
    expect(r.typed.at(-1)!.id).toBe('ses-planner-2')
    expect(r.typed.at(-1)!.text).toContain('also the tablet view')
    expect(r.typed.at(-1)!.text).toContain(`jobs-replan-done --id ${jobId}`)
    expect((await r.as('ses-planner-2')('jobs-replan-done', { id: jobId, summary: 'both views' })).status).toBe(200)
    expect(r.state().jobs[0].feedback!.map((f) => f.changes)).toEqual([['no change: both views'], ['no change: both views']])
  })

  it('queues feedback while the replan planner is not there, and replays it when the replan ends or its planner is gone', async () => {
    for (const end of [{ summary: 'done' }, { gone: true }]) {
      const r = rig({ alive: false })
      const jobId = await replanning(r)
      expect(await r.person('jobs-feedback', { job: jobId, text: 'second' })).toMatchObject({ status: 200, body: { via: 'queued' } })
      expect(await r.person('jobs-feedback', { job: jobId, text: 'third' })).toMatchObject({ status: 200, body: { via: 'queued' } })
      expect(r.state().jobs[0].feedback!.filter((f) => f.queued)).toHaveLength(2)
      const as = 'gone' in end ? r.person : r.as('ses-planner-2')
      expect((await as('jobs-replan-done', { id: jobId, ...end })).status).toBe(200)
      const job = r.state().jobs[0]
      expect(job.replanning?.sessionId).toBe('ses-planner-3')
      expect(job.feedback!.some((f) => f.queued)).toBe(false)
      expect(job.feedback![0].changes).toBeDefined()
      const brief = r.starts.at(-1)!.brief as string
      expect(brief).toContain('second')
      expect(brief).toContain('third')
      expect((await r.as('ses-planner-3')('jobs-replan-done', { id: jobId, summary: 'both' })).status).toBe(200)
      expect(r.state().jobs[0].feedback!.slice(1).map((f) => f.changes)).toEqual([['no change: both'], ['no change: both']])
    }
  })

  it('reopens a finished plan with a final-check replan for the feedback; its follow-ups run, past the follow-up cap', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    const s = r.state()
    const runId = s.runs[0].id
    r.set({
      ...s,
      jobs: s.jobs.map((j) => ({ ...j, replanFollowUps: 3 })),
      runs: s.runs.map(({ coordinatorSessionId: _c, ...run }) => run),
      tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t))
    })
    const reply = await r.person('jobs-feedback', { job: jobId, text: 'add a dark mode' })
    expect(reply.status).toBe(200)
    expect(r.state().jobs[0].replanning).toMatchObject({ mode: 'completion', feedbackAt: NOW })
    const brief = r.starts.at(-1)!.brief as string
    expect(brief).toContain('add a dark mode')
    expect(brief).toContain('finished')
    const sid = (reply.body as { sessionId: string }).sessionId
    expect((await r.as(sid)('task-create', { run: runId, ...plan('dark', { kind: 'feature' }) })).status).toBe(200)
    const coordinators = r.starts.filter((x) => x.role !== 'planner').length
    expect((await r.as(sid)('jobs-replan-done', { id: jobId, summary: 'dark mode Task' })).status).toBe(200)
    const job = r.state().jobs[0]
    expect(job.lastReplan?.escalated).toBeUndefined()
    expect(job.dispatchHold).toBeUndefined()
    expect(job.replanFollowUps).toBe(3)
    // The run is running again, and gets a coordinator so its new Task is placed
    expect(r.starts.filter((x) => x.role !== 'planner').length).toBe(coordinators + 1)
    expect(r.state().runs[0].coordinatorSessionId).toBe('ses-coordinator')
  })

  it('still refuses an archived plan', async () => {
    const r = rig()
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    const s = r.state()
    r.set({ ...s, jobs: s.jobs.map((j) => ({ ...j, archivedAt: NOW })) })
    expect((await r.person('jobs-feedback', { job: jobId, text: 'x' })).status).toBe(409)
  })

  it('every way the feedback reaches a planner teaches --kind', () => {
    expect(feedbackLine('job_1', 'x')).toContain('--kind bugfix|feature|refactor|ui|audit|docs|test|ops')
    expect(resumeBrief('job_1', 'x')).toContain('--kind bugfix|feature|refactor|ui|audit|docs|test|ops')
  })
})

describe('plannerProblemsNotice', () => {
  const job = { id: 'job_1', objective: 'Archive the stale plans of the project', cwd: '/repo', pendingStart: true, plannerSessionIds: ['ses-p1'], createdAt: NOW } as unknown as OrchState['jobs'][number]
  const task = { id: 'tsk_1', title: 'Archive', jobId: 'job_1', deps: [], status: 'pending', prompt: 'p', acceptanceCriteria: ['c'], basis: { state: 'missing', evidence: 'e' } } as unknown as Task
  const state = (t: Partial<Task>, j: Partial<typeof job> = {}): OrchState => ({ ...emptyState(), jobs: [{ ...job, ...j }], tasks: [{ ...task, ...t }] })

  it('lists what keeps the plan from approval, the same list under the same key', () => {
    const n = plannerProblemsNotice(state({}), 'ses-p1')!
    expect(n.text).toContain('tsk_1 (Archive) names no files')
    expect(n.text).toContain('the plan has no real name')
    expect(plannerProblemsNotice(state({}), 'ses-p1')!.key).toBe(n.key)
  })

  it('has nothing to say once the Task says --no-files and the plan has its name', () => {
    expect(plannerProblemsNotice(state({ kind: 'ops', noFiles: true }, { title: 'Archive plans' }), 'ses-p1')).toBeNull()
  })

  it('says nothing to a session that is not the latest planner of a plan awaiting approval', () => {
    expect(plannerProblemsNotice(state({}), 'ses-other')).toBeNull()
    expect(plannerProblemsNotice(state({}, { pendingStart: false }), 'ses-p1')).toBeNull()
  })
})

describe('T2 jobs-chat: a planner chat on a finished plan', () => {
  /** A planned plan whose Tasks all completed and whose coordinator has ended. */
  const finished = async (r: Rig, job: Partial<Job> = {}) => {
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    const s = r.state()
    const runId = s.runs[0].id
    r.set({
      ...s,
      jobs: s.jobs.map((j) => ({ ...j, ...job })),
      runs: s.runs.map(({ coordinatorSessionId: _c, ...run }) => run),
      tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t))
    })
    return { jobId, runId }
  }

  it('starts a completion replan with the chat brief and answers its session; a second call answers the same one', async () => {
    const r = rig()
    const { jobId, runId } = await finished(r)
    const reply = await r.person('jobs-chat', { id: jobId })
    expect(reply).toMatchObject({ status: 200, body: { jobId, runId, sessionId: 'ses-planner-2' } })
    expect(r.state().jobs[0].replanning).toMatchObject({ mode: 'completion', chat: true, sessionId: 'ses-planner-2' })
    expect(r.state().jobs[0].dispatchHold).toBe(true)
    const brief = r.starts.at(-1)!.brief as string
    expect(brief).toContain('OWNER CHAT')
    expect(brief).toContain('Do not change files')
    expect(brief).not.toContain('OWNER FEEDBACK')
    expect(brief).not.toContain('THE FINAL CHECK')
    const starts = r.starts.length
    expect(await r.person('jobs-chat', { id: jobId })).toMatchObject({ status: 200, body: { jobId, runId, sessionId: 'ses-planner-2' } })
    expect(r.starts).toHaveLength(starts)
  })

  it('ended with no new Task, leaves the plan completed with the hold lifted, also with replanning off', async () => {
    for (const job of [{}, { replan: 'off' as const }]) {
      const r = rig()
      const { jobId, runId } = await finished(r, job)
      const sid = ((await r.person('jobs-chat', { id: jobId })).body as { sessionId: string }).sessionId
      const coordinators = r.starts.filter((x) => x.role !== 'planner').length
      expect((await r.as(sid)('jobs-replan-done', { id: jobId, summary: 'answered two questions' })).status).toBe(200)
      const after = r.state().jobs[0]
      expect(after.replanning).toBeUndefined()
      expect(after.dispatchHold).toBeUndefined()
      expect(after.lastReplan).toMatchObject({ runId, mode: 'completion', summary: 'done, nothing to add: answered two questions' })
      expect(outcomeOf(r.state(), runId)).toBe('completed')
      expect(r.stopped).toContain(sid)
      expect(r.starts.filter((x) => x.role !== 'planner').length).toBe(coordinators)
    }
  })

  it('adds a follow-up Task when asked: the plan runs again past the follow-up cap, and its ended delivery reopens', async () => {
    const r = rig()
    const { jobId, runId } = await finished(r, { replanFollowUps: 3 })
    const s = r.state()
    r.set({ ...s, runs: s.runs.map((x) => ({ ...x, delivery: { at: NOW, branch: 'main', sha: 'abc1234' }, pr: { at: NOW, url: 'https://github.com/o/r/pull/1', landed: 'merged' as const } })) })
    const sid = ((await r.person('jobs-chat', { id: jobId })).body as { sessionId: string }).sessionId
    expect((await r.as(sid)('task-create', { run: runId, ...plan('dark', { kind: 'feature' }) })).status).toBe(200)
    expect((await r.as(sid)('jobs-replan-done', { id: jobId, summary: 'dark mode Task' })).status).toBe(200)
    const job = r.state().jobs[0]
    expect(job.dispatchHold).toBeUndefined()
    expect(job.replanFollowUps).toBe(3)
    const run = r.state().runs[0]
    expect(run.delivery).toBeUndefined()
    expect(run.pr).toBeUndefined()
    expect(run.coordinatorSessionId).toBe('ses-coordinator')
    expect(outcomeOf(r.state(), runId)).toBe('running')
  })

  it('refuses an unknown, archived, unplanned or still running plan, and an agent', async () => {
    const r = rig()
    expect((await r.person('jobs-chat', { id: 'job_nope' })).status).toBe(404)
    const made = await r.person('run-create', { objective: 'o', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    expect((await r.person('jobs-chat', { id: (made.body as { id: string }).id })).status).toBe(409)
    const { jobId } = await planned(r)
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    expect((await r.person('jobs-chat', { id: jobId })).status).toBe(409)
    expect((await r.as('ses-someone')('jobs-chat', { id: jobId })).status).toBe(403)
    expect((await handleCommand(r.deps, { sessionId: '', role: 'mcp' }, 'jobs-chat', { id: jobId })).status).toBe(403)
    const s = r.state()
    r.set({ ...s, jobs: s.jobs.map((j) => ({ ...j, archivedAt: NOW })), tasks: s.tasks.map((t) => (t.runId ? { ...t, status: 'completed' as const } : t)) })
    expect((await r.person('jobs-chat', { id: jobId })).status).toBe(409)
    expect(r.starts.filter((x) => x.role === 'planner')).toHaveLength(1)
  })
})
