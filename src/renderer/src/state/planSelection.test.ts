import { describe, expect, it } from 'vitest'
import { openRunCheck, pendingAfterOpen, pendingRunStep, planNameOf, planToOpen } from './planSelection'
import type { WorkspaceProject } from './workspaceTree'
import type { JobRow, OrchSnapshot } from '../../../core/types'

const row = (id: string): JobRow => ({
  id, objective: id, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: []
})
const snap = (project: string | undefined, runs: JobRow[]): OrchSnapshot => ({ runs, projectFolderBusy: false, ...(project ? { project } : {}) })

describe('openRunCheck', () => {
  const openRun = { projectPath: '/b', runId: 'rb' }

  it("keeps B's open plan when a push of project A lands after switching to B", () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/a', [row('ra')]), seen: true })).toEqual({ close: false, found: false })
  })

  it("closes it when B's own snapshot no longer has the Run", () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/b', []), seen: true }).close).toBe(true)
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap(undefined, []), seen: true }).close).toBe(true)
  })

  it('keeps it while the Run is there, and before the first snapshot', () => {
    expect(openRunCheck({ openRun, currentProject: '/b', snap: snap('/b', [row('rb')]), seen: false })).toEqual({ close: false, found: true })
    expect(openRunCheck({ openRun, currentProject: '/b', snap: null, seen: false }).close).toBe(false)
  })

  it('closes a local plan of another project than the current one', () => {
    expect(openRunCheck({ openRun, currentProject: '/a', snap: snap('/b', [row('rb')]), seen: true }).close).toBe(true)
  })
})

describe('pendingRunStep', () => {
  const pending = { projectPath: '/b', runId: 'rb' }

  it('opens once its project is current', () => {
    expect(pendingRunStep(pending, '/b', '/a')).toBe('open')
  })

  it('waits while the switch that brings its project has not landed', () => {
    expect(pendingRunStep(pending, '/a', '/a')).toBe('wait')
  })

  it('is dropped on a switch to an unrelated project, so it never steals focus later', () => {
    expect(pendingRunStep(pending, '/c', '/a')).toBe('drop')
    expect(pendingRunStep(pending, null, '/a')).toBe('drop')
  })
})

describe('pendingAfterOpen', () => {
  const pending = { projectPath: '/b', runId: 'rb' }

  it('drops the pending plan when the owner opens another one', () => {
    expect(pendingAfterOpen(pending, { projectPath: '/a', runId: 'ra' })).toBeNull()
  })

  it('keeps it for the plan it opened, and when nothing opened', () => {
    expect(pendingAfterOpen(pending, pending)).toBe(pending)
    expect(pendingAfterOpen(pending, null)).toBe(pending)
  })
})

describe('planToOpen', () => {
  const base = { tabRunId: 'rb', openRun: null, currentProject: '/b', treePath: '/b', known: undefined }

  it('opens the active tab\'s plan of the current project once openRun went null', () => {
    expect(planToOpen(base)).toEqual({ projectPath: '/b', runId: 'rb' })
  })

  it('does nothing while the plan is already open', () => {
    expect(planToOpen({ ...base, openRun: { projectPath: '/b', runId: 'rb' } })).toBeNull()
  })

  it('opens it when another plan is open', () => {
    expect(planToOpen({ ...base, openRun: { projectPath: '/b', runId: 'other' } })).toEqual({ projectPath: '/b', runId: 'rb' })
  })

  it('never opens a plan of another local project against the wrong project', () => {
    expect(planToOpen({ ...base, currentProject: '/a' })).toBeNull()
    expect(planToOpen({ ...base, currentProject: '/a', treePath: undefined, known: { projectPath: '/b', runId: 'rb' } })).toBeNull()
  })

  it('falls back to the current project when the plan\'s project is unknown', () => {
    expect(planToOpen({ ...base, treePath: undefined })).toEqual({ projectPath: '/b', runId: 'rb' })
    expect(planToOpen({ ...base, treePath: undefined, currentProject: null })).toBeNull()
  })

  it('gives null when the active tab is not a plan tab', () => {
    expect(planToOpen({ ...base, tabRunId: null })).toBeNull()
  })

  it('keeps a remote plan as remembered, whatever the current project', () => {
    const known = { projectPath: '/r', runId: 'rb', runtimeId: 'rt1' }
    expect(planToOpen({ ...base, currentProject: '/a', known })).toBe(known)
  })
})

describe('planNameOf', () => {
  const plan = (jobId: string, runId: string | undefined, name: string): WorkspaceProject['plans'][number] =>
    ({ jobId, runId, name, projectId: 'p', archived: false, paused: false, planner: [], coordinator: [], workers: [] })
  const tree: WorkspaceProject[] = [
    { id: 'p1', name: 'A', path: '/a', plans: [plan('j1', 'r1', 'Alpha')] },
    { id: 'p2', name: 'B', path: '/b', plans: [plan('j2', 'r2', 'Beta')] }
  ]

  it('finds a plan of any project by its Run or Job id', () => {
    expect(planNameOf(tree, 'r2')).toBe('Beta')
    expect(planNameOf(tree, 'j1')).toBe('Alpha')
  })

  it('gives undefined for an unknown plan, and without a tree', () => {
    expect(planNameOf(tree, 'nope')).toBeUndefined()
    expect(planNameOf(undefined, 'r1')).toBeUndefined()
  })
})
