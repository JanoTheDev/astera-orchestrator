// W8-D several plans in one repo: the cross-plan file guard (schedule.ts, blocked.ts), the overlap check (overlap.ts),
// the planner's brief, and plan areas (`jobs-set --areas`, `jobs-list --area`).
import { describe, expect, it } from 'vitest'
import { taskBoardsOf } from './blocked'
import { handleCommand, type OrchServerDeps } from './command'
import { buildPlannerBrief } from './handover'
import { areasArg, otherPlansBrief, overlapLines, overlapsOf, refreshOverlaps } from './overlap'
import { plannerRefusal } from './planner'
import { slotsToFill } from './schedule'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'
import { buildReplanBrief } from './exec/replanStart'
import { deriveActivity, noticeOf, type ActivityEvent } from './activity'

const T0 = '2026-10-18T00:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  objective: id,
  cwd: '/repo',
  projectId: 'prj_1',
  createdAt: T0,
  autoDispatch: true,
  concurrency: 3,
  ...over
})
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, owner: { runId?: string; jobId?: string }, over: Partial<Task> = {}): Task => ({
  id,
  ...owner,
  title: id.toUpperCase(),
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const dispatch = (id: string, taskId: string): Dispatch => ({
  id,
  taskId,
  provider: 'claude',
  accountId: 'acc_1',
  sessionId: `ses_${id}`,
  cwd: '/repo',
  specPath: '/spec',
  startedAt: T0,
  workerState: 'ready',
  retained: false
})

/** Plan A ("Auth rework", r1) has T6 at src/api/routes.ts with a worker on it; plan B (r2) has a ready T3 on the same
 *  file. `bOver` moves plan B (another project, say). */
const twoPlans = (bOver: Partial<Job> = {}): OrchState => ({
  ...emptyState(),
  jobs: [job('jA', { title: 'Auth rework' }), job('jB', { title: 'Api cleanup', ...bOver })],
  runs: [run('r1', 'jA'), run('r2', 'jB')],
  tasks: [
    task('t6', { runId: 'r1' }, { title: 'T6', status: 'dispatched', affectedPaths: ['src/api/routes.ts'] }),
    task('t3', { runId: 'r2' }, { title: 'T3', affectedPaths: ['src/api/'] })
  ],
  dispatches: [dispatch('d6', 't6')]
})

describe('the cross-plan file guard', () => {
  it('holds a ready Task while another plan of the same project edits its files', () => {
    expect(slotsToFill(twoPlans())).toEqual([])
  })

  it('lets it run once that worker is done and its plan delivered (T9: until then the files stay leased)', () => {
    const s = twoPlans()
    const done: OrchState = {
      ...s,
      tasks: s.tasks.map((t) => (t.id === 't6' ? { ...t, status: 'completed' as const } : t)),
      dispatches: s.dispatches.map((d) => ({ ...d, outcome: 'succeeded' as const, endedAt: T0 }))
    }
    expect(slotsToFill(done)).toEqual([])
    const delivered: OrchState = { ...done, runs: done.runs.map((r) => (r.id === 'r1' ? { ...r, pr: { at: T0, url: 'https://x/pr/1', number: 1 } } : r)) }
    expect(slotsToFill(delivered).map((x) => x.taskId)).toEqual(['t3'])
  })

  it('never holds across projects', () => {
    expect(slotsToFill(twoPlans({ projectId: 'prj_2', cwd: '/other' })).map((x) => x.taskId)).toEqual(['t3'])
  })

  it('places one of two ready Tasks of two plans on the same files in one pass', () => {
    const s = twoPlans()
    const both: OrchState = { ...s, tasks: s.tasks.map((t) => ({ ...t, status: 'ready' as const })), dispatches: [] }
    expect(slotsToFill(both)).toHaveLength(1)
  })

  it('names the other plan and Task in the blocked reason', () => {
    const reason = taskBoardsOf(twoPlans()).get('t3')?.reason
    expect(reason).toEqual({ kind: 'same-files', waitingOn: { id: 't6', title: 'T6' }, path: 'src/api/', plan: { id: 'jA', title: 'Auth rework' } })
    // its words: renderer planBoard.test.ts
  })

  it('keeps the plain reason inside one plan', () => {
    const s = twoPlans()
    const one: OrchState = { ...s, tasks: s.tasks.map((t) => (t.id === 't3' ? { ...t, runId: 'r1' } : t)) }
    expect(taskBoardsOf(one).get('t3')?.reason).toEqual({ kind: 'same-files', waitingOn: { id: 't6', title: 'T6' }, path: 'src/api/' })
  })
})

describe('overlapsOf', () => {
  /** Plan jB not started yet (definition Tasks), beside a running plan jA. */
  const queued = (mine: Partial<Task>, theirs: Partial<Task>): OrchState => ({
    ...emptyState(),
    jobs: [job('jA', { title: 'Auth rework' }), job('jB', { pendingStart: true })],
    runs: [run('r1', 'jA')],
    tasks: [task('t6', { runId: 'r1' }, { title: 'T6', ...theirs }), task('b1', { jobId: 'jB' }, { status: 'pending', ...mine })]
  })

  it('finds overlapping affected paths', () => {
    const s = queued({ affectedPaths: ['src/api/routes.ts'] }, { affectedPaths: ['src/api/'] })
    expect(overlapsOf(s.jobs[1], s)).toEqual([{ taskId: 'b1', jobId: 'jA', otherTaskId: 't6', by: 'path', path: 'src/api/routes.ts' }])
  })

  it('finds the same linked issue', () => {
    const issue = { number: 12, url: 'u' }
    const s = queued({ affectedPaths: ['a.ts'], links: { issue } }, { affectedPaths: ['b.ts'], links: { issue } })
    expect(overlapsOf(s.jobs[1], s)).toEqual([{ taskId: 'b1', jobId: 'jA', otherTaskId: 't6', by: 'issue', issue: 12 }])
  })

  it('finds nothing across projects, against an archived plan, or a finished one', () => {
    const base = queued({ affectedPaths: ['src/'] }, { affectedPaths: ['src/'] })
    const other = { ...base, jobs: [job('jA', { projectId: 'prj_2' }), base.jobs[1]] }
    const archived = { ...base, jobs: [job('jA', { archivedAt: T0 }), base.jobs[1]] }
    const finished = { ...base, tasks: base.tasks.map((t) => (t.id === 't6' ? { ...t, status: 'completed' as const } : t)) }
    for (const s of [other, archived, finished]) expect(overlapsOf(s.jobs[1], s)).toEqual([])
  })

  it('is refreshed on Job.overlaps of both plans when a Task changes, and reads as one line each', () => {
    const before = queued({ affectedPaths: ['a.ts'] }, { affectedPaths: ['b.ts'] })
    const same = refreshOverlaps(before, before)
    expect(same).toBe(before)
    const moved: OrchState = { ...before, tasks: before.tasks.map((t) => (t.id === 'b1' ? { ...t, affectedPaths: ['b.ts'] } : t)) }
    const after = refreshOverlaps(before, moved)
    expect(after.jobs.find((j) => j.id === 'jB')?.overlaps).toEqual([{ taskId: 'b1', jobId: 'jA', otherTaskId: 't6', by: 'path', path: 'b.ts' }])
    expect(after.jobs.find((j) => j.id === 'jA')?.overlaps).toEqual([{ taskId: 't6', jobId: 'jB', otherTaskId: 'b1', by: 'path', path: 'b.ts' }])
    expect(overlapLines(after, after.jobs[1])).toEqual(['B1 · Auth rework · T6 (same files: b.ts)'])
    // and dropped again when it moves away
    const back = refreshOverlaps(after, { ...after, tasks: before.tasks })
    expect(back.jobs.every((j) => j.overlaps === undefined)).toBe(true)
  })
})

describe('the briefs list the other plans of the repository', () => {
  const s: OrchState = {
    ...emptyState(),
    jobs: [job('jA', { title: 'Auth rework', areas: ['auth'] }), job('jB', { pendingStart: true }), job('jC', { projectId: 'prj_2', title: 'Elsewhere' })],
    runs: [run('r1', 'jA')],
    tasks: [task('t6', { runId: 'r1' }, { title: 'T6', status: 'completed', affectedPaths: ['src/api/routes.ts'] })]
  }

  it("in the planner's brief: their Tasks, state and paths", () => {
    const other = otherPlansBrief(s, s.jobs[1])
    expect(other).toContain('Auth rework (job jA, completed, areas: auth)')
    // T1: a finished plan is one line, with no Task lines
    expect(other).toContain('1 Tasks done (astera tasks list --run jA --json)')
    expect(other).not.toContain('T6 [completed]')
    expect(other).not.toContain('Elsewhere')
    const brief = buildPlannerBrief({ jobId: 'jB', objective: 'o', repoRoot: '/repo', accountId: 'acc_1', concurrency: 2, otherPlans: other })
    expect(brief).toContain('OTHER PLANS IN THIS REPOSITORY')
    expect(brief).toContain('--areas')
    expect(otherPlansBrief(s, s.jobs[2])).toBe('')
  })

  it("in the replan's brief", () => {
    const brief = buildReplanBrief({ job: s.jobs[1], runId: 'r2', mode: 'wave', wave: 1, accountId: 'a', followUps: 0, done: [], running: [], left: [], otherPlans: otherPlansBrief(s, s.jobs[1]) })
    expect(brief).toContain('Auth rework (job jA, completed, areas: auth): 1 Tasks done (astera tasks list --run jA --json)')
  })
})

describe('plan areas', () => {
  it('parses 1 to 3 short words, and none', () => {
    expect(areasArg('Auth, api,auth')).toEqual(['auth', 'api'])
    expect(areasArg('["ui"]')).toEqual(['ui'])
    expect(areasArg('none')).toEqual([])
    expect(areasArg('a,b,c,d')).toHaveProperty('error')
    expect(areasArg('has space')).toHaveProperty('error')
  })

  it('a planner sets its own Job’s areas only', () => {
    const s: OrchState = { ...emptyState(), jobs: [job('jB', { pendingStart: true, plannerSessionIds: ['ses_p'] })] }
    expect(plannerRefusal(s, 'ses_p', 'jobs-set', { id: 'jB', areas: 'api' })).toBeNull()
    expect(plannerRefusal(s, 'ses_p', 'jobs-set', { id: 'jB', concurrency: 2 })).toMatch(/areas only/)
    expect(plannerRefusal(s, 'ses_p', 'jobs-set', { id: 'jX', areas: 'api' })).toMatch(/areas only/)
    expect(plannerRefusal(s, 'ses_p', 'jobs-overlaps', { id: 'jB' })).toBeNull()
  })

  it('jobs-set --areas, jobs-list --area and jobs-overlaps', async () => {
    const box = { state: twoPlans() as OrchState }
    const deps = { getState: () => box.state, setState: async (n: OrchState) => void (box.state = n), now: () => T0 } as unknown as OrchServerDeps
    const call = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
    expect((await call('jobs-set', { id: 'jA', areas: 'auth,api' })).status).toBe(200)
    expect(box.state.jobs[0].areas).toEqual(['auth', 'api'])
    expect((await call('jobs-set', { id: 'jA', areas: 'auth', concurrency: 2 })).status).toBe(400)
    const listed = await call('jobs-list', { area: 'api' })
    expect((listed.body as { id: string }[]).map((j) => j.id)).toEqual(['jA'])
    expect((await call('jobs-set', { id: 'jA', areas: 'none' })).status).toBe(200)
    expect(box.state.jobs[0].areas).toBeUndefined()

    box.state = refreshOverlaps(emptyState(), box.state)
    const o = await call('jobs-overlaps', { id: 'jB' })
    expect(o.status).toBe(200)
    expect((o.body as { overlaps: { line: string }[] }).overlaps.map((x) => x.line)).toEqual(['T3 · Auth rework · T6 (same files: src/api/)'])
  })
})

describe('plan.overlap', () => {
  it('is a feed line and a notice with no chime, once per new overlap', () => {
    const before = twoPlans({ pendingStart: true })
    const after = refreshOverlaps(emptyState(), before)
    const drafts = deriveActivity(before, after).filter((d) => d.type === 'plan.overlap')
    expect(drafts.map((d) => [d.jobId, d.payload.overlaps])).toEqual([
      ['jA', ['T6 · Api cleanup · T3 (same files: src/api/routes.ts)']],
      ['jB', ['T3 · Auth rework · T6 (same files: src/api/)']]
    ])
    const notice = noticeOf({ ...drafts[1], id: 'e1', sequence: 1, occurredAt: T0 } satisfies ActivityEvent)
    expect(notice?.title).toBe('Plans overlap')
    expect(notice?.alert).toBeUndefined()
    // a Run's start copies the Tasks under new ids: the same overlap says nothing again
    const started: OrchState = { ...after, tasks: after.tasks.map((t) => (t.id === 't3' ? { ...t, id: 't3b' } : t)) }
    expect(deriveActivity(after, refreshOverlaps(after, started)).filter((d) => d.type === 'plan.overlap')).toEqual([])
    // a finished plan meets nothing
    const finished: OrchState = { ...after, tasks: after.tasks.map((t) => ({ ...t, status: 'completed' as const })) }
    expect(refreshOverlaps(after, finished).jobs.every((j) => j.overlaps === undefined)).toBe(true)
    // the same overlaps again say nothing
    expect(deriveActivity(after, refreshOverlaps(after, { ...after, tasks: [...after.tasks] })).filter((d) => d.type === 'plan.overlap')).toEqual([])
  })
})

describe('the project coordinator (T9)', () => {
  const coordinatorMail = (s: OrchState, runId: string): string[] =>
    s.messages.filter((m) => m.runId === runId && m.type === 'status').map((m) => m.subject)

  it('a new overlap posts one message to the waiting plan’s coordinator, once', () => {
    const after = refreshOverlaps(emptyState(), twoPlans(), T0)
    // jA was made first (same stamp: the smaller id), so jB waits
    expect(coordinatorMail(after, 'r2')).toEqual(['Another plan of this project goes first: T3 · Auth rework · T6 (same files: src/api/)'])
    expect(coordinatorMail(after, 'r1')).toEqual([])
    expect(refreshOverlaps(after, { ...after, tasks: [...after.tasks] }, T0).messages).toHaveLength(after.messages.length)
  })

  it('a lease that starts to hold a Task back posts one message to its plan’s coordinator', () => {
    const before = refreshOverlaps(emptyState(), twoPlans(), T0)
    const done: OrchState = {
      ...before,
      tasks: before.tasks.map((t) => (t.id === 't6' ? { ...t, status: 'completed' as const } : t)),
      dispatches: before.dispatches.map((d) => ({ ...d, outcome: 'succeeded' as const, endedAt: T0 }))
    }
    const after = refreshOverlaps(before, done, T0)
    expect(coordinatorMail(after, 'r2').slice(coordinatorMail(before, 'r2').length)).toEqual([
      'Waiting for another plan to deliver: T3 waits for Auth rework · T6 to deliver src/api/'
    ])
    expect(refreshOverlaps(after, { ...after, tasks: [...after.tasks] }, T0).messages).toHaveLength(after.messages.length)
  })

  /** Plan A ("Auth rework") has T6 for issue #7; plan B, made later, a ready T3 for the same issue. */
  const duplicate = (t3: Partial<Task> = {}): OrchState => ({
    ...emptyState(),
    jobs: [job('jA', { title: 'Auth rework' }), job('jB', { title: 'Api cleanup', createdAt: '2026-10-18T01:00:00.000Z' })],
    runs: [run('r1', 'jA'), run('r2', 'jB')],
    tasks: [
      task('t6', { runId: 'r1' }, { title: 'Fix login', links: { issue: { number: 7, url: 'u' } } }),
      task('t3', { runId: 'r2' }, { title: 'Other', links: { issue: { number: 7, url: 'u' } }, ...t3 })
    ]
  })

  it('holds a not-started duplicate behind one owner decision', () => {
    const after = refreshOverlaps(emptyState(), duplicate(), T0)
    const gates = after.gates.filter((g) => g.taskId === 't3')
    expect(gates).toHaveLength(1)
    expect(gates[0].options).toEqual(['cancel as duplicate', 'keep both'])
    expect(gates[0].question).toContain('same issue #7')
    expect(after.tasks.find((t) => t.id === 't3')?.status).toBe('blocked')
    expect(after.messages.filter((m) => m.type === 'decision_gate' && m.taskId === 't3')).toHaveLength(1)
    // the plan that goes first is never held
    expect(after.gates.some((g) => g.taskId === 't6')).toBe(false)
    expect(refreshOverlaps(after, { ...after, tasks: [...after.tasks] }, T0).gates).toHaveLength(1)
  })

  it('holds the same title on overlapping paths, not the same title elsewhere, nor a started Task', () => {
    const titled = (paths: string[]): OrchState => {
      const s = duplicate({ title: 'fix login ', links: undefined, affectedPaths: paths })
      return { ...s, tasks: s.tasks.map((t) => (t.id === 't6' ? { ...t, affectedPaths: ['src/auth/'] } : t)) }
    }
    expect(refreshOverlaps(emptyState(), titled(['src/auth/login.ts']), T0).gates).toHaveLength(1)
    expect(refreshOverlaps(emptyState(), titled(['docs/']), T0).gates).toHaveLength(0)
    const started = { ...duplicate(), dispatches: [{ ...dispatch('d3', 't3'), outcome: 'failed' as const, endedAt: T0 }] }
    expect(refreshOverlaps(emptyState(), started, T0).gates).toHaveLength(0)
  })

  it('carries out the answer: cancel removes the Task, keep both lets it run and never asks again', async () => {
    const { resolveGate } = await import('./state')
    const held = refreshOverlaps(emptyState(), duplicate(), T0)
    const gateId = held.gates[0].id
    const answer = (resolution: string): OrchState => {
      const r = resolveGate(held, { gateId, resolution }, T0)
      if (!r.ok) throw new Error(r.error)
      return refreshOverlaps(held, r.state, T0)
    }
    expect(answer('cancel as duplicate').tasks.some((t) => t.id === 't3')).toBe(false)
    const kept = answer('keep both')
    expect(kept.tasks.find((t) => t.id === 't3')?.status).toBe('ready')
    expect(kept.gates.filter((g) => g.status === 'open')).toEqual([])
  })
})
