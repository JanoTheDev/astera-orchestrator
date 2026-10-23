// T3 workspaces: plans of sibling sub-projects of one repository share the workspace's file guard, leases and overlap
// check (projectKeyOf); plans on different files still run side by side.
import { describe, expect, it } from 'vitest'
import { overlapsOf } from './overlap'
import { leasesByProject, projectKeyOf, slotsToFill } from './schedule'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Project, Task } from './types'

const T0 = '2026-10-18T00:00:00.000Z'

// T7: the guard and leases hold on a workspace with serial files on
const projects: Project[] = [
  { id: 'prj_root', path: '/repo', name: 'Astera', addedAt: T0, serialFiles: true },
  { id: 'prj_ui', path: '/repo', name: 'ui', addedAt: T0, parentId: 'prj_root' },
  { id: 'prj_core', path: '/repo', name: 'core', addedAt: T0, parentId: 'prj_root' },
  { id: 'prj_other', path: '/other', name: 'other', addedAt: T0, serialFiles: true }
]
const job = (id: string, projectId: string): Job => ({ id, objective: id, cwd: '/repo', projectId, createdAt: T0, autoDispatch: true, concurrency: 3 })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id,
  runId,
  title: id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const dispatch = (id: string, taskId: string): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'acc_1', sessionId: `ses_${id}`, cwd: '/repo', specPath: '/spec', startedAt: T0, workerState: 'ready', retained: false })

/** Plan A in sub-project ui has a Task at `aPaths` in `aStatus`; plan B in sibling core has a ready Task at `bPaths`. */
const siblings = (aPaths: string[], bPaths: string[], aStatus: Task['status'] = 'ready'): OrchState => ({
  ...emptyState(),
  projects,
  jobs: [job('jA', 'prj_ui'), job('jB', 'prj_core')],
  runs: [run('r1', 'jA'), run('r2', 'jB')],
  tasks: [task('ta', 'r1', { status: aStatus, affectedPaths: aPaths }), task('tb', 'r2', { affectedPaths: bPaths })]
})
const placed = (s: OrchState): string[] => slotsToFill(s).map((x) => x.taskId).sort()

describe('projectKeyOf (T3 workspaces)', () => {
  it('a sub-project keys by its workspace; a root and an old Job keep theirs', () => {
    const s = { projects }
    expect(projectKeyOf(s, { projectId: 'prj_ui', cwd: '/repo' })).toBe('prj_root')
    expect(projectKeyOf(s, { projectId: 'prj_root', cwd: '/repo' })).toBe('prj_root')
    expect(projectKeyOf(s, { projectId: 'prj_other', cwd: '/other' })).toBe('prj_other')
    expect(projectKeyOf(s, { cwd: '/repo' })).toBe('cwd:/repo')
  })
})

describe('sibling sub-projects share one coordinator', () => {
  it('holds a ready Task while a sibling plan edits the same files', () => {
    const s = siblings(['src/api/routes.ts'], ['src/api/'], 'dispatched')
    expect(placed({ ...s, dispatches: [dispatch('d1', 'ta')] })).toEqual([])
  })

  it('a completed Task of an undelivered sibling plan leases its files, and the other plan waits', () => {
    const s = siblings(['src/api/routes.ts'], ['src/api/'], 'completed')
    expect(leasesByProject(s).get('prj_root')?.map((l) => l.id)).toEqual(['ta'])
    expect(placed(s)).toEqual([])
  })

  it('records an overlap between sibling plans', () => {
    const s = siblings(['src/api/routes.ts'], ['src/api/'])
    expect(overlapsOf(s.jobs[1], s)).toEqual([{ taskId: 'tb', jobId: 'jA', otherTaskId: 'ta', by: 'path', path: 'src/api/' }])
  })

  it('places plans on different files side by side', () => {
    expect(placed(siblings(['src/renderer/'], ['src/core/']))).toEqual(['ta', 'tb'])
    const running = siblings(['src/renderer/'], ['src/core/'], 'dispatched')
    expect(placed({ ...running, dispatches: [dispatch('d1', 'ta')] })).toEqual(['tb'])
  })

  it("T7: the workspace's serial files hold for its sub-projects; a sub-project's own does not", () => {
    const s = siblings(['src/api/routes.ts'], ['src/api/'], 'completed')
    const flip = (root: boolean, ui: boolean): OrchState => ({
      ...s,
      projects: s.projects.map((p) => (p.id === 'prj_root' ? { ...p, serialFiles: root } : p.id === 'prj_ui' ? { ...p, serialFiles: ui } : p))
    })
    expect(placed(flip(false, true))).toEqual(['tb'])
    expect(placed(flip(true, false))).toEqual([])
  })

  it('never holds across workspaces', () => {
    const s = siblings(['src/api/routes.ts'], ['src/api/'], 'dispatched')
    const apart: OrchState = { ...s, jobs: s.jobs.map((j) => (j.id === 'jB' ? { ...j, projectId: 'prj_other', cwd: '/other' } : j)), dispatches: [dispatch('d1', 'ta')] }
    expect(placed(apart)).toEqual(['tb'])
  })
})
