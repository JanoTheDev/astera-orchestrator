import { describe, expect, it } from 'vitest'
import type { Attention, JobRow, JobTask, SessionInfo } from '../../../../core/types'
import type { WorkspaceProject, WorkspaceSession } from '../../state/workspaceTree'
import {
  ALL_PLANS, NO_PLAN, activityOf, consolesOf, detailLineOf, detailsOf, filterConsoles, gridColumns, groupWall, indexJobRows, orderWall, pillCount, planPills,
  PREVIEW_LINES, previewOf, progressSegments, sectionWall, stripLabel, tileMenuOf, type WallConsole, type WallInput
} from './wallModel'

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, accountId: 'acc1', cwd: '/repo', status: 'running', title: id, ...over
})
const ws = (sessionId: string, role: WorkspaceSession['role'], label: string, plan: string, over: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  sessionId, role, label: `${plan} ${label}`, projectName: 'Repo', planName: plan, ...over
})
const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `Task ${id}`, status: 'dispatched', openGates: 0, ...over })
const row = (id: string, tasks: JobTask[], over: Partial<JobRow> = {}): JobRow =>
  ({ id, objective: id, outcome: 'running', done: tasks.filter((t) => t.status === 'completed').length, total: tasks.length, eventCount: 0, sharesProjectFolder: false, tasks, ...over }) as unknown as JobRow

// The jobs-view fold: a Job with one Run is one row, keyed by the Job id, its Run named by foldedRunId. A Job with
// several Runs (or a schedule) is a row keyed by the Job id whose Runs are its children, each keyed by its own id.
const jobs = {
  // job_1 (one Run, run_1) — the Auth plan
  folded: row('job_1', [
    task('t1', { startedAt: '2026-10-18T10:00:00Z', affectedPaths: ['a.ts', 'b.ts'], board: { category: 'running' } }),
    task('t2', { status: 'reviewing', board: { category: 'awaiting-review' }, convergence: { reviewRound: 2, maxReviewRounds: 3 } as JobTask['convergence'] }),
    task('t4', { status: 'completed', board: { category: 'done' } }),
    task('t5', { status: 'pending', board: { category: 'queued' }, gate: { id: 'g1', question: 'Which DB?' }, openGates: 1 })
  ], { foldedRunId: 'run_1' }),
  // job_2 — planned, not started, no Run yet: keyed by its Job id alone
  planned: row('job_2', [task('t3', { board: { category: 'running' } })], { pendingStart: true, planned: true, planReady: true })
}

const tree: WorkspaceProject[] = [
  {
    id: 'p1', name: 'Repo', path: '/repo',
    plans: [
      {
        jobId: 'job_1', projectId: 'p1', name: 'Auth', archived: false, paused: false, runId: 'run_1',
        planner: [ws('pl1', 'planner', 'Planner', 'Auth')],
        coordinator: [ws('c1', 'coordinator', 'Coordinator', 'Auth')],
        workers: [
          ws('w1', 'worker', 'Worker 1', 'Auth', { taskId: 't1', taskTitle: 'Login form' }),
          ws('w2', 'worker', 'Worker 2', 'Auth', { taskId: 't2', taskTitle: 'Tokens' })
        ]
      },
      {
        jobId: 'job_2', projectId: 'p1', name: 'Board', archived: false, paused: false,
        planner: [], coordinator: [ws('c2', 'coordinator', 'Coordinator', 'Board')],
        workers: [ws('w3', 'worker', 'Worker 1', 'Board', { taskId: 't3', taskTitle: 'Scores' })]
      },
      { jobId: 'job_3', projectId: 'p1', name: 'Old', archived: true, paused: false, planner: [], coordinator: [], workers: [] }
    ]
  },
  { id: 'p2', name: 'Other', path: '/other', plans: [] }
]

const rows = indexJobRows([jobs.folded, jobs.planned])

const attention: Record<string, Attention> = { c1: 'working', w1: 'working', w2: 'idle', w3: 'waiting', c2: 'idle', s9: 'working' }

const input = (over: Partial<WallInput> = {}): WallInput => ({
  sessions: ['c1', 'pl1', 'w1', 'w2', 'c2', 'w3'].map((id) => session(id)).concat(session('s9', { title: 'my shell' }), session('e1', { status: 'exited', exitCode: 0, cwd: '/other' })),
  tree,
  data: { dispatches: [{ sessionId: 'w2', review: true } as never], worktrees: [] },
  attention,
  live: { w3: { prompt: 'permission' } },
  rows,
  ...over
})

describe('indexJobRows', () => {
  it('keys a folded Job row by its Job id and its Run id, and each nested Run by its own id', () => {
    const nested = row('job_4', [], { children: [row('run_4a', [task('x')]), row('run_4b', [task('y')])] })
    const idx = indexJobRows([jobs.folded, nested])
    expect(Object.keys(idx).sort()).toEqual(['job_1', 'job_4', 'run_1', 'run_4a', 'run_4b'])
    expect(idx.run_1).toBe(jobs.folded)
    expect(idx.job_1).toBe(jobs.folded)
    expect(idx.run_4b.tasks.map((t) => t.id)).toEqual(['y'])
    expect(idx.job_4.children).toHaveLength(2)
  })
})

describe('consolesOf', () => {
  const cs = consolesOf(input())
  const by = (id: string) => cs.find((c) => c.sessionId === id)!
  it('reads each console role from the workspace tree and its Dispatch', () => {
    expect(by('c1').role).toBe('coordinator')
    expect(by('pl1').role).toBe('planner')
    expect(by('w1').role).toBe('worker')
    expect(by('w2').role).toBe('reviewer')
    expect(by('s9').role).toBe('console')
  })
  it('drops the plan name from the label and keeps a plain console title', () => {
    expect(by('w1').label).toBe('Worker 1')
    expect(by('s9').label).toBe('my shell')
  })
  it('a permission prompt is danger, a Gate warn, an ended session finished', () => {
    expect(by('w3')).toMatchObject({ state: 'needs', needs: 'permission', tone: 'danger' })
    expect(by('e1').state).toBe('finished')
    expect(by('w1').state).toBe('working')
    expect(by('w2').state).toBe('idle')
  })
  it('places a plain console in its project by cwd', () => {
    expect(by('s9').projectId).toBe('p1')
    expect(by('e1').projectId).toBe('p2')
  })
})

describe('orderWall and filterConsoles', () => {
  const cs = consolesOf(input())
  const f = { plan: ALL_PLANS, state: 'all' as const, scope: 'project' as const, projectId: 'p1' }
  it('pins every plan coordinator first in plan order, then each plan\'s planner, workers by number, plain consoles last', () => {
    const w = orderWall(filterConsoles(cs, f), ALL_PLANS)
    expect(w.pinned.map((c) => c.sessionId)).toEqual(['c1', 'c2'])
    expect(w.tiles.map((c) => c.sessionId)).toEqual(['pl1', 'w1', 'w2', 'w3', 's9'])
    expect(w.mainId).toBeNull()
  })
  it('one plan picked: only its consoles, its coordinator the main tile', () => {
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'job_1' }), 'job_1')
    expect(w.pinned.map((c) => c.sessionId)).toEqual(['c1'])
    expect(w.mainId).toBe('c1')
    expect(w.tiles.map((c) => c.sessionId)).toEqual(['pl1', 'w1', 'w2'])
  })
  it('the order does not change when a console flips between working, idle and needs', () => {
    const ids = (c: typeof cs) => {
      const w = orderWall(c, ALL_PLANS)
      return [...w.pinned, ...w.tiles].map((x) => x.sessionId)
    }
    const before = ids(cs)
    for (const state of ['needs', 'working', 'idle'] as const)
      expect(ids(cs.map((c) => (c.sessionId === 'w2' || c.sessionId === 'pl1' ? { ...c, state } : c)))).toEqual(before)
  })
  it('orders workers by label number, not text', () => {
    const w = (id: string, label: string): (typeof cs)[number] => ({ ...cs.find((c) => c.sessionId === 'w1')!, sessionId: id, label })
    expect(orderWall([w('a', 'Worker 10'), w('b', 'Worker 2')], ALL_PLANS).tiles.map((c) => c.sessionId)).toEqual(['b', 'a'])
  })
  it('No plan keeps the plain consoles only', () => {
    expect(filterConsoles(cs, { ...f, plan: NO_PLAN }).map((c) => c.sessionId)).toEqual(['s9'])
  })
  it('the project scope hides another project; all projects shows it', () => {
    expect(filterConsoles(cs, f).some((c) => c.sessionId === 'e1')).toBe(false)
    expect(filterConsoles(cs, { ...f, scope: 'all' }).some((c) => c.sessionId === 'e1')).toBe(true)
  })
  it('the state filter keeps one state; finished consoles go to the Finished row', () => {
    expect(filterConsoles(cs, { ...f, state: 'needs' }).map((c) => c.sessionId)).toEqual(['w3'])
    expect(orderWall(filterConsoles(cs, { ...f, scope: 'all' }), ALL_PLANS).finished.map((c) => c.sessionId)).toEqual(['e1'])
  })
  it('the strip labels the main coordinator and a worker with its Task', () => {
    const w = orderWall(filterConsoles(cs, { ...f, plan: 'job_1' }), 'job_1')
    expect(stripLabel(w.pinned[0], w.mainId)).toBe('Coordinator (main)')
    expect(stripLabel(cs.find((c) => c.sessionId === 'w1')!, w.mainId)).toBe('Worker 1 · Login form')
  })
})

describe('groupWall', () => {
  it('groups the wall by plan in plan order, plain consoles last, each group its live tiles then its finished ones', () => {
    const w = orderWall(consolesOf(input()), ALL_PLANS)
    const groups = groupWall([...w.pinned, ...w.tiles], w.finished)
    expect(groups.at(-1)?.key).toBe(NO_PLAN)
    expect(groups.find((g) => g.key === NO_PLAN)?.live.map((c) => c.sessionId)).toEqual(['s9'])
    const one = groups.find((g) => g.key === 'job_1')!
    expect(one.live.map((c) => c.sessionId)).toEqual(['c1', 'pl1', 'w1', 'w2'])
    expect(groups.flatMap((g) => g.done).map((c) => c.sessionId)).toEqual(['e1'])
  })
  it('the Done filter leaves a group of finished consoles only', () => {
    const w = orderWall(consolesOf(input()), ALL_PLANS)
    expect(groupWall([], w.finished).every((g) => g.live.length === 0 && g.done.length > 0)).toBe(true)
  })
})

describe('sectionWall', () => {
  const w = orderWall(consolesOf(input()), ALL_PLANS)
  const live = [...w.pinned, ...w.tiles]
  const ids = (cs: { sessionId: string }[]): string[] => cs.map((c) => c.sessionId)
  it('splits by role: coordinators, planners, workers with the reviewer, consoles; each keeps orderWall order', () => {
    const s = sectionWall(live, w.finished)
    expect(s.map((x) => x.role)).toEqual(['coordinator', 'planner', 'worker', 'console'])
    expect(ids(s[0].live)).toEqual(['c1', 'c2'])
    expect(ids(s[1].live)).toEqual(['pl1'])
    expect(ids(s[2].live)).toEqual(['w1', 'w2', 'w3'])
    expect(consolesOf(input()).find((c) => c.sessionId === 'w2')?.role).toBe('reviewer')
    expect(ids(s[3].live)).toEqual(['s9'])
    expect(ids(s[3].done)).toEqual(['e1'])
    expect(s.map((x) => x.count)).toEqual([2, 1, 3, 2])
  })
  it('leaves out an empty section and counts finished consoles', () => {
    const s = sectionWall(live.filter((c) => c.role !== 'planner'), w.finished)
    expect(s.map((x) => x.role)).toEqual(['coordinator', 'worker', 'console'])
    expect(sectionWall([], w.finished).map((x) => [x.role, x.count])).toEqual([['console', 1]])
    expect(sectionWall([], [])).toEqual([])
  })
})

describe('gridColumns', () => {
  it('1–4 → 2, 5–9 → 3, 10+ → 4', () => {
    expect([1, 4, 5, 9, 10, 12].map(gridColumns)).toEqual([2, 2, 3, 3, 4, 4])
  })
})

describe('planPills', () => {
  const cs = consolesOf(input())
  const pills = planPills(tree, rows, cs, 'p1', 'project')
  it('lists the active plans of the project, archived ones left out', () => {
    expect(pills.map((p) => p.jobId)).toEqual(['job_1', 'job_2'])
    expect(planPills(tree, rows, cs, 'p2', 'project')).toEqual([])
    expect(planPills(tree, rows, cs, 'p2', 'all').map((p) => p.jobId)).toEqual(['job_1', 'job_2'])
  })
  it('counts progress by category and what needs the owner', () => {
    const auth = pills[0]
    expect(auth.progress.counts).toMatchObject({ done: 1, running: 1, 'awaiting-review': 1, queued: 1 })
    expect([auth.done, auth.total, auth.needs]).toEqual([1, 4, 1])
    const words = { approve: 'approve', need: (n: number) => `${n} need you` }
    expect(pillCount(auth, words)).toBe('1/4 · 1 need you')
    // A planned plan waiting for approval says so instead of a count; its waiting worker still counts as needing the owner.
    expect(pills[1].approve).toBe(true)
    expect(pills[1].needs).toBe(1)
    expect(pillCount(pills[1], words)).toBe('approve')
  })
  it('#116: no approve while the planner plans, nor for a plan that starts by itself', () => {
    const pill = (over: Partial<JobRow>) => planPills(tree, { ...rows, job_2: { ...rows.job_2, planReady: undefined, ...over } }, cs, 'p1', 'project')[1]
    expect(pill({}).approve).toBe(false)
    expect(pill({ autoApprove: true }).approve).toBe(false)
    expect(pill({ planReady: true, autoApprove: true }).approve).toBe(true)
  })
  it('the stacked bar has one segment per category present, sharing the whole', () => {
    const segs = progressSegments(pills[0].progress)
    expect(segs.map((s) => s.category)).toEqual(['done', 'running', 'awaiting-review', 'queued'])
    expect(segs.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1)
  })
})

describe('the wall reads progress from the fold rows', () => {
  // job_5: one Run (run_5), folded onto its Job row. job_6: nested, its latest Run (run_6b) is a child.
  const folded = row('job_5', [
    task('a', { status: 'completed', board: { category: 'done' } }),
    task('b', { board: { category: 'running' } })
  ], { foldedRunId: 'run_5' })
  const nested = row('job_6', [], {
    children: [
      row('run_6a', [task('c', { status: 'completed', board: { category: 'done' } })]),
      row('run_6b', [
        task('d', { board: { category: 'running' } }),
        task('e', { board: { category: 'queued' } }),
        task('f', { status: 'completed', board: { category: 'done' } })
      ])
    ]
  })
  const labTree: WorkspaceProject[] = [{
    id: 'p3', name: 'Lab', path: '/lab',
    plans: [
      {
        jobId: 'job_5', projectId: 'p3', name: 'Folded', archived: false, paused: false, runId: 'run_5',
        planner: [], coordinator: [], workers: [ws('wf', 'worker', 'Worker 1', 'Folded', { taskId: 'b', taskTitle: 'Running' })]
      },
      {
        jobId: 'job_6', projectId: 'p3', name: 'Nested', archived: false, paused: false, runId: 'run_6b',
        planner: [], coordinator: [], workers: [ws('wn', 'worker', 'Worker 1', 'Nested', { taskId: 'd', taskTitle: 'Next' })]
      }
    ]
  }]
  const labRows = indexJobRows([folded, nested])
  const labData = { sessions: [session('wf'), session('wn')], tree: labTree, data: null, attention: {}, live: {}, rows: labRows }

  it('a plan pill reports the real done and total of its folded Run and of its nested Job’s latest Run', () => {
    const pills = planPills(labTree, labRows, consolesOf(labData), 'p3', 'project')
    expect(pills.map((p) => [p.jobId, p.done, p.total])).toEqual([['job_5', 1, 2], ['job_6', 1, 3]])
  })

  it('detailsOf reports the plan’s real done and total and lists its Tasks', () => {
    const cs = consolesOf(labData)
    const d = detailsOf({
      console: cs.find((c) => c.sessionId === 'wn')!,
      consoles: cs,
      rows: labRows,
      tree: labTree,
      tasks: [],
      answeredOf: () => 0,
      escalatedOf: () => 0
    })
    expect([d.plan!.done, d.plan!.total]).toEqual([1, 3])
    expect(d.plan!.tasks.map((t) => t.id)).toEqual(['d', 'e', 'f'])
    expect(d.task).toMatchObject({ title: 'Next' })
  })
})

describe('activityOf', () => {
  const c = (over: Partial<WallConsole> = {}): WallConsole =>
    ({ sessionId: 's', label: 'Worker 1', role: 'worker', state: 'working', projectId: null, planOrder: 0, cwd: '/repo', chat: false, ...over })
  const at = 1_000

  it('an edit names the file from the console’s folder', () => {
    expect(activityOf(c(), { tool: 'Edit', target: '/repo/src/a.ts', at })).toEqual({ key: 'wall.activity.editing', params: { file: 'src/a.ts' } })
    expect(activityOf(c(), { tool: 'Write', target: '/elsewhere/b.ts', at })).toEqual({ key: 'wall.activity.editing', params: { file: '/elsewhere/b.ts' } })
  })

  it('a command names its first word', () => {
    expect(activityOf(c(), { tool: 'Bash', target: 'npx vitest run x', at })).toEqual({ key: 'wall.activity.running', params: { cmd: 'npx' } })
  })

  it('a read or a search is reading code', () => {
    expect(activityOf(c(), { tool: 'Read', target: '/repo/a.ts', at }).key).toBe('wall.activity.reading')
    expect(activityOf(c(), { tool: 'Grep', target: 'foo', at }).key).toBe('wall.activity.reading')
  })

  it('no tool call, an unknown tool or an idle console says its state', () => {
    expect(activityOf(c(), undefined).key).toBe('wall.state.working')
    expect(activityOf(c(), { tool: 'WebFetch', target: 'x', at }).key).toBe('wall.state.working')
    expect(activityOf(c({ state: 'idle' }), { tool: 'Edit', target: '/repo/a.ts', at }).key).toBe('wall.state.idle')
    expect(activityOf(c({ state: 'finished' }), undefined).key).toBe('wall.state.finished')
  })

  it('a console waiting on the owner says what it waits for', () => {
    expect(activityOf(c({ state: 'needs', needs: 'question' }), { tool: 'Edit', target: 'a', at }).key).toBe('wall.activity.question')
    expect(activityOf(c({ state: 'needs', needs: 'permission' }), undefined).key).toBe('wall.activity.permission')
    expect(activityOf(c({ state: 'needs', needs: 'gate' }), undefined).key).toBe('wall.activity.gate')
  })
})

describe('a chat tile', () => {
  it('shows the last lines of its last reply, bottom-anchored', () => {
    const reply = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(PREVIEW_LINES).toBe(6)
    expect(previewOf(reply)).toBe('line 4\nline 5\nline 6\nline 7\nline 8\nline 9')
  })

  it('updates when a newer reply arrives: the preview follows the reply it is given', () => {
    expect(previewOf('first answer')).toBe('first answer')
    expect(previewOf('first answer\nand more')).toBe('first answer\nand more')
  })

  it('has no preview before a reply, or for a blank one', () => {
    expect(previewOf(null)).toBeNull()
    expect(previewOf('  \n ')).toBeNull()
  })

  it('its overflow menu has Open in new window, which opens the window on the console project', () => {
    const c = consolesOf({ sessions: [session('chat1', { kind: 'chat' })], tree: [], data: null, attention: {}, live: {}, rows: {} })[0]
    const opened: Array<string | null> = []
    const items = tileMenuOf(c, { openWindow: 'Open in new window' }, (projectId) => opened.push(projectId))
    expect(items.map((i) => i.label)).toEqual(['Open in new window'])
    items[0].onSelect()
    expect(opened).toEqual([c.projectId])
  })
})
