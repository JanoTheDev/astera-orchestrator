// W8-D several plans in one repo: the cross-plan file guard (schedule.ts, blocked.ts), the overlap check (overlap.ts),
// the planner's brief, and plan areas (`jobs-set --areas`, `jobs-list --area`).
import { describe, expect, it } from 'vitest'
import { taskBoardsOf } from './blocked'
import { handleCommand, type OrchServerDeps } from './command'
import { buildPlannerBrief } from './handover'
import {
  areasArg,
  DROPPED_OPTIONS,
  mainPlanText,
  otherPlansBrief,
  overlapLines,
  overlapsOf,
  planOverlapWarnings,
  plannerOverlapNotices,
  refreshOverlaps,
  STOPPED_DEP_OPTIONS,
  taskCreateWarnings,
  titleSimilarity
} from './overlap'
import { plannerRefusal } from './planner'
import { LEASE_WAIT_OPTIONS, slotsToFill } from './schedule'
import { emptyState, resolveGate, type OrchState } from './state'
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
 *  file. `bOver` moves plan B (another project, say). T7: on a project with serial files on, where the guard holds. */
const twoPlans = (bOver: Partial<Job> = {}, serialFiles = true): OrchState => ({
  ...emptyState(),
  projects: [{ id: 'prj_1', path: '/repo', name: 'repo', addedAt: T0, serialFiles }],
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
    jobs: [job('jA', { title: 'Auth rework', areas: ['auth'] }), job('jB', { pendingStart: true }), job('jC', { projectId: 'prj_2', title: 'Elsewhere' }), job('jD', { title: 'Live plan' })],
    runs: [run('r1', 'jA'), run('r4', 'jD')],
    tasks: [
      task('t6', { runId: 'r1' }, { title: 'T6', status: 'completed', affectedPaths: ['src/api/routes.ts'] }),
      task('t9', { runId: 'r4' }, { title: 'T9', status: 'dispatched', affectedPaths: ['src/ui/'] })
    ]
  }

  it("in the planner's brief: the main plan, with the open Tasks of live plans", () => {
    const other = otherPlansBrief(s, s.jobs[1])
    expect(other).toContain('MAIN PLAN OF THIS PROJECT')
    expect(other).toContain('depend on its Task with `--deps <taskId>` (it waits until that plan delivers) or leave it out, and name it in')
    // a finished plan is one line, with no Task lines
    expect(other).toContain('- Auth rework (job jA, completed, areas: auth)')
    expect(other).not.toContain('T6')
    // an active plan lists its Tasks not completed: id, title, status, paths
    expect(other).toContain('Live plan (job jD')
    expect(other).toContain('  - t9 T9 [dispatched]: src/ui/')
    expect(other).not.toContain('Elsewhere')
    const brief = buildPlannerBrief({ jobId: 'jB', objective: 'o', repoRoot: '/repo', accountId: 'acc_1', concurrency: 2, otherPlans: other })
    expect(brief).toContain('MAIN PLAN OF THIS PROJECT')
    expect(brief).toContain('--areas')
    expect(otherPlansBrief(s, s.jobs[2])).toBe('')
  })

  it("in the replan's brief", () => {
    const brief = buildReplanBrief({ job: s.jobs[1], runId: 'r2', mode: 'wave', wave: 1, accountId: 'a', followUps: 0, done: [], running: [], left: [], otherPlans: otherPlansBrief(s, s.jobs[1]) })
    expect(brief).toContain('- Auth rework (job jA, completed, areas: auth)')
  })

  it('lists the links of live plans, and counts Tasks past the cap', () => {
    const linked: OrchState = {
      ...s,
      tasks: [...s.tasks, task('t10', { runId: 'r4' }, { title: 'T10', status: 'pending', deps: ['t6'] })]
    }
    expect(otherPlansBrief(linked, linked.jobs[1])).toContain('link: t10 waits on t6 (not delivered)')
    const many: OrchState = {
      ...s,
      tasks: [...s.tasks, ...Array.from({ length: 45 }, (_, i) => task(`m${i}`, { runId: 'r4' }, { status: 'pending' }))]
    }
    expect(otherPlansBrief(many, many.jobs[1])).toContain('… 6 more (astera main-plan --json)')
  })

  it('is shorter than the old list of every Task for ten plans', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => job(`j${i}`, { title: `Plan number ${i}`, areas: ['api'] }))
    const runs = jobs.map((j, i) => run(`rr${i}`, j.id))
    // plans 0-6 finished with 6 Tasks each; plans 7-9 running with 4 done and 2 open
    const tasks = jobs.flatMap((j, i) =>
      Array.from({ length: 6 }, (_, n) =>
        task(`tsk_${i}_${n}`, { runId: `rr${i}` }, { title: `Task ${i}.${n} of the plan`, status: i < 7 || n < 4 ? 'completed' : 'ready', affectedPaths: [`src/area${i}/file${n}.ts`] })
      )
    )
    const big: OrchState = { ...emptyState(), jobs: [...jobs, job('me', { pendingStart: true })], runs, tasks }
    // the old brief: five rules lines, then every Task of every plan, a finished plan with its count and command
    const old = [
      'OTHER PLANS IN THIS REPOSITORY',
      'Other plans work in this repository too. Never plan a Task another plan already holds: if one of yours would',
      'do the same work, leave it out and name that plan and Task in existing.md (as you would an open issue). Plan',
      'around their files where you can; where you cannot, say so in existing.md. Astera runs no two workers on the',
      'same files at once, so an overlap only waits, but duplicated work is wasted.',
      ...jobs.flatMap((j, i) => [
        `- ${j.title} (job ${j.id}, ${i < 7 ? 'completed' : 'running'}, areas: api)` + (i < 7 ? ': 6 Tasks done (astera tasks list --run ' + j.id + ' --json)' : ''),
        ...(i < 7 ? [] : tasks.filter((t) => t.runId === `rr${i}`).map((t) => `  - ${t.title} [${t.status}]: ${t.affectedPaths!.join(', ')}`))
      ])
    ].join('\n')
    const now = otherPlansBrief(big, big.jobs[10])
    expect(now).toContain('Plan number 9')
    expect(now.length).toBeLessThan(old.length)
  })
})

describe('astera main-plan text', () => {
  it('includes every plan, the caller’s own too, and is empty for a project with none', () => {
    const s: OrchState = { ...emptyState(), jobs: [job('jA'), job('jB', { pendingStart: true })] }
    expect(mainPlanText(s, 'prj_1')).toMatch(/- jA .*\n- jB /s)
    expect(mainPlanText(s, 'prj_9')).toBe('')
  })
})

describe('the stopped-dependency Gate is asked once per Task and dep', () => {
  it('a second dep that stops opens its own Gate after "keep waiting"; the same dep is never asked twice', () => {
    const base: OrchState = {
      ...emptyState(),
      jobs: [job('jA', { archivedAt: T0 }), job('jC', { archivedAt: T0 }), job('jB')],
      runs: [run('r1', 'jA'), run('r3', 'jC'), run('r2', 'jB')],
      tasks: [
        task('tA', { runId: 'r1' }, { status: 'completed' }),
        task('tC', { runId: 'r3' }, { status: 'completed' }),
        task('tB', { runId: 'r2' }, { deps: ['tA', 'tC'], status: 'pending' })
      ]
    }
    const keep = (from: OrchState): OrchState => {
      const open = from.gates.find((g) => g.status === 'open')!
      const r = resolveGate(from, { gateId: open.id, resolution: STOPPED_DEP_OPTIONS[0] }, T0)
      if (!r.ok) throw new Error(r.error)
      return refreshOverlaps(from, r.state, T0)
    }
    const first = refreshOverlaps(emptyState(), base, T0)
    expect(first.gates).toHaveLength(1)
    expect(first.gates[0].question).toContain('[dep tA]')
    const second = keep(first)
    expect(second.gates.map((g) => g.status)).toEqual(['resolved', 'open'])
    expect(second.gates[1].question).toContain('[dep tC]')
    // both answered "keep waiting": nothing more is asked, however often the state moves
    const third = keep(second)
    expect(third.gates).toHaveLength(2)
    expect(refreshOverlaps(third, { ...third, tasks: [...third.tasks] }, T0).gates).toHaveLength(2)
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

  it('T7: without serial files the overlap message says both run and the merge worker settles a conflict', () => {
    const after = refreshOverlaps(emptyState(), twoPlans({}, false), T0)
    expect(slotsToFill(twoPlans({}, false)).map((x) => x.taskId)).toEqual(['t3'])
    const mail = after.messages.filter((m) => m.runId === 'r2')
    expect(mail.map((m) => m.subject)).toEqual([
      'Another plan of this project edits the same files and goes first; the merge may need the merge worker: T3 · Auth rework · T6 (same files: src/api/)'
    ])
    expect(mail[0].body).toContain('the merge worker settles a conflict')
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

describe('plans that know about each other (T11)', () => {
  /** Two plans still planning at the same time, each with a definition Task on src/api/, each with a live planner. */
  const planning = (): OrchState => ({
    ...emptyState(),
    jobs: [
      job('jA', { title: 'Auth rework', pendingStart: true, plannerSessionIds: ['ses_pa'] }),
      job('jB', { title: 'Api cleanup', pendingStart: true, plannerSessionIds: ['ses_old', 'ses_pb'] })
    ],
    tasks: [
      task('ta', { jobId: 'jA' }, { title: 'Rework routes', status: 'pending', affectedPaths: ['src/api/routes.ts'] }),
      task('tb', { jobId: 'jB' }, { title: 'Clean handlers', status: 'pending', affectedPaths: ['src/api/'] })
    ]
  })

  it('two planning plans with overlapping paths: each latest planner gets one notice naming the other plan, its Tasks and the paths', () => {
    const s = refreshOverlaps(emptyState(), planning(), T0)
    const notices = plannerOverlapNotices(s)
    expect(notices.map((n) => n.sessionId).sort()).toEqual(['ses_pa', 'ses_pb'])
    const toA = notices.find((n) => n.sessionId === 'ses_pa')!
    expect(toA.text).toContain('Api cleanup (job jB)')
    expect(toA.text).toContain('Clean handlers')
    expect(toA.text).toContain('src/api/routes.ts')
    // the same pair and paths keep the same key, so the Host tells it once
    expect(plannerOverlapNotices(refreshOverlaps(s, { ...s, tasks: [...s.tasks] }, T0)).map((n) => n.key)).toEqual(notices.map((n) => n.key))
    // a plan that started is no longer told as a planner
    expect(plannerOverlapNotices({ ...s, jobs: s.jobs.map((j) => (j.id === 'jA' ? { ...j, pendingStart: undefined } : j)) }).map((n) => n.sessionId)).toEqual(['ses_pb'])
  })

  it('before approval the plan lists its open overlaps with plans planning or running, never blocking', async () => {
    const s = planning()
    expect(planOverlapWarnings(s, 'jA')).toEqual(['Rework routes · Api cleanup · Clean handlers (same files: src/api/routes.ts)'])
    // a plan archived (or finished) is no open overlap
    expect(planOverlapWarnings({ ...s, jobs: s.jobs.map((j) => (j.id === 'jB' ? { ...j, archivedAt: T0 } : j)) }, 'jA')).toEqual([])
    // run-start approves the plan and carries the lines in its answer
    const ready = (t: Task): Task => ({ ...t, prompt: 'p', acceptanceCriteria: ['c'], basis: { state: 'missing', evidence: 'e' } })
    let st: OrchState = { ...s, tasks: s.tasks.map(ready) }
    const deps = { getState: () => st, setState: async (n: OrchState) => void (st = n), now: () => T0 } as unknown as OrchServerDeps
    const reply = await handleCommand(deps, { sessionId: '' }, 'run-start', { run: 'jA' })
    expect(reply.status).toBe(200)
    expect((reply.body as { overlaps?: string[] }).overlaps).toEqual(['Rework routes · Api cleanup · Clean handlers (same files: src/api/routes.ts)'])
  })

  it('reads the other plan running by its shared run outcome: an empty Run nothing can add Tasks to is no overlap', () => {
    const s = twoPlans()
    // jB's Run lost its only Task and nothing can add one: it reads failed, not running
    expect(planOverlapWarnings({ ...s, tasks: s.tasks.filter((t) => t.id !== 't3') }, 'jA')).toEqual([])
    // a plan with a running Task still warns
    expect(planOverlapWarnings(s, 'jA')).toEqual(['T6 · Api cleanup · T3 (same files: src/api/routes.ts)'])
    // its only Task held for the owner (blocked, no open Gate) reads blocked, not running
    expect(planOverlapWarnings({ ...s, tasks: s.tasks.map((t) => (t.id === 't3' ? { ...t, status: 'blocked' as const } : t)) }, 'jA')).toEqual([])
  })

  it('jobs-plan-ready, before approval, answers with the open overlaps and still marks the plan ready', async () => {
    const ready = (t: Task): Task => ({ ...t, prompt: 'p', acceptanceCriteria: ['c'], basis: { state: 'missing', evidence: 'e' } })
    let st: OrchState = { ...planning(), tasks: planning().tasks.map(ready) }
    const deps = { getState: () => st, setState: async (n: OrchState) => void (st = n), now: () => T0 } as unknown as OrchServerDeps
    const reply = await handleCommand(deps, { sessionId: '' }, 'jobs-plan-ready', { id: 'jA' })
    expect(reply.status).toBe(200)
    expect((reply.body as { overlaps?: string[] }).overlaps).toEqual(['Rework routes · Api cleanup · Clean handlers (same files: src/api/routes.ts)'])
    expect(st.jobs.find((j) => j.id === 'jA')?.planReadyAt).toBe(T0)
    expect(st.jobs.find((j) => j.id === 'jA')?.pendingStart).toBe(true)
  })

  it('titles alike by words (Jaccard >= 0.6)', () => {
    expect(titleSimilarity('Fix the login form', 'fix login form')).toBeGreaterThanOrEqual(0.6)
    expect(titleSimilarity('Fix login', 'Rework billing page')).toBe(0)
  })

  it('task-create warns of a similar title on overlapping paths of another plan, not a similar title elsewhere', () => {
    const s = planning()
    const mine = (title: string, paths: string[]): Task => task('tn', { jobId: 'jB' }, { title, status: 'pending', affectedPaths: paths })
    const warn = taskCreateWarnings(s, mine('Rework routes api', ['src/api/routes.ts']))
    expect(warn).toHaveLength(1)
    expect(warn[0]).toContain('"Rework routes" (ta) of plan Auth rework')
    expect(warn[0]).toContain('similar title, same files: src/api/routes.ts')
    expect(taskCreateWarnings(s, mine('Rework routes api', ['docs/']))).toEqual([])
    expect(taskCreateWarnings(s, mine('Write docs', ['src/api/routes.ts']))).toEqual([])
  })

  it('task-create answers with the warning line', async () => {
    let s: OrchState = { ...planning(), tasks: planning().tasks.filter((t) => t.id === 'ta') }
    const deps = {
      getState: () => s,
      setState: async (n: OrchState) => void (s = n),
      listAccounts: async () => [{ id: 'acc_1' }],
      now: () => T0
    } as unknown as OrchServerDeps
    const reply = await handleCommand(deps, { sessionId: '' }, 'task-create', {
      run: 'jB',
      spec: 'x',
      title: 'Rework routes api',
      account: 'acc_1',
      affectedPaths: ['src/api/routes.ts'],
      prompt: 'p',
      criteria: ['c']
    })
    expect(reply.status).toBe(200)
    expect((reply.body as { warnings?: string[] }).warnings?.[0]).toContain('possible duplicate')
  })

  it('a similar title on overlapping paths is held as a duplicate too', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [job('jA', { title: 'Auth rework' }), job('jB', { title: 'Api cleanup', createdAt: '2026-10-18T01:00:00.000Z' })],
      runs: [run('r1', 'jA'), run('r2', 'jB')],
      tasks: [
        task('t6', { runId: 'r1' }, { title: 'Fix the login form', affectedPaths: ['src/auth/'] }),
        task('t3', { runId: 'r2' }, { title: 'fix login form', affectedPaths: ['src/auth/form.ts'] })
      ]
    }
    expect(refreshOverlaps(emptyState(), s, T0).gates[0]?.question).toContain('similar title')
  })

  it('carries out the watchdog questions: cancel, another account, retry once more', async () => {
    const { createGate, resolveGate } = await import('./state')
    const base: OrchState = {
      ...emptyState(),
      jobs: [job('jA')],
      runs: [run('r1', 'jA')],
      tasks: [task('t1', { runId: 'r1' }, { accountIds: ['acc_1', 'acc_2'], consecutiveFailures: 3 })]
    }
    const answered = (options: readonly string[], resolution: string): OrchState => {
      const g = createGate(base, { taskId: 't1', question: 'q', options: [...options] }, T0)
      if (!g.ok) throw new Error(g.error)
      const r = resolveGate(g.state, { gateId: g.value.id, resolution }, T0)
      if (!r.ok) throw new Error(r.error)
      return refreshOverlaps(g.state, r.state, T0)
    }
    expect(answered(LEASE_WAIT_OPTIONS, 'Cancel this Task').tasks.some((t) => t.id === 't1')).toBe(false)
    expect(answered(LEASE_WAIT_OPTIONS, 'Let it wait').tasks.find((t) => t.id === 't1')?.status).toBe('ready')
    expect(answered(DROPPED_OPTIONS, 'Use another account').tasks[0]).toMatchObject({ accountIds: ['acc_2', 'acc_1'], consecutiveFailures: 0 })
    expect(answered(DROPPED_OPTIONS, 'Retry once more').tasks[0]).toMatchObject({ consecutiveFailures: 2 })
  })
})
