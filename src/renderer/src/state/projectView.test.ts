import { describe, expect, it } from 'vitest'
import type { Project } from '../../../core/orchestration/types'
import type { WallInput } from '../components/wall/wallModel'
import { projectScopeOf, repoInScope, scopeData, scopeSessions, scopeTree, selectionAfterFocus, UNKNOWN_PROJECT } from './projectView'
import { OTHER_WORKSPACE, projectOfCwd, workspaceSessionIds, type WorkspaceData, type WorkspaceProject, type WorktreeRef } from './workspaceTree'

// Two projects, one worktree session of each. B's worktree is registered; A's is not (a fresh or forgotten one).
const A = '/home/jonx/Desktop/Astera'
const B = '/home/jonx/Desktop/Gameful'
const tree: WorkspaceProject[] = [
  { id: 'pA', name: 'Astera', path: A, plans: [{ jobId: 'jA', projectId: 'pA', name: 'PlanA', archived: false, paused: false, planner: [], coordinator: [], workers: [] }] },
  { id: 'pB', name: 'Gameful', path: B, plans: [{ jobId: 'jB', projectId: 'pB', name: 'PlanB', archived: false, paused: false, planner: [], coordinator: [], workers: [] }] }
]
const worktrees: WorktreeRef[] = [
  { path: '/home/jonx/astera-worktrees/Gameful/plan-x', repoPath: B },
  { path: '/home/jonx/astera-worktrees/Astera/first', repoPath: A }
]
const sessions = [
  { id: 'sA', cwd: '/home/jonx/astera-worktrees/Astera/second/src', status: 'running', title: 'a', accountId: 'x' }, // unregistered worktree of A
  { id: 'sB', cwd: '/home/jonx/astera-worktrees/Gameful/plan-x', status: 'running', title: 'b', accountId: 'x' }
] as unknown as WallInput['sessions']

describe('projectOfCwd: a session in a worktree folder', () => {
  it('resolves a registered worktree to its repo project', () => {
    expect(projectOfCwd('/home/jonx/astera-worktrees/Gameful/plan-x/src', tree, worktrees)).toBe('pB')
  })
  it('resolves an unregistered worktree under the same <root>/<Project>/ to that project, not null or the other', () => {
    expect(projectOfCwd('/home/jonx/astera-worktrees/Astera/second/src', tree, worktrees)).toBe('pA')
    expect(projectOfCwd('/home/jonx/astera-worktrees/Gameful/other', tree, worktrees)).toBe('pB')
  })
  it('a root shared by several repos says nothing', () => {
    const shared: WorktreeRef[] = [{ path: '/wt/a1', repoPath: A }, { path: '/wt/b1', repoPath: B }]
    expect(projectOfCwd('/wt/new', tree, shared)).toBeNull()
  })
})

describe('projectScopeOf: every view follows the title bar\'s selection', () => {
  const projects = [
    { id: 'pA', path: A, name: 'Astera' },
    { id: 'pB', path: B, name: 'Gameful' },
    { id: 'sub', path: A, name: 'Sub', parentId: 'pA' }
  ] as unknown as Project[]
  it('a selected project gives its folder and its own scope', () => {
    expect(projectScopeOf(projects, 'pB', null)).toMatchObject({ projectId: 'pB', path: B, isAll: false, scopeId: 'pB' })
  })
  it('a selected sub-project gives its workspace\'s folder and scope, and keeps its own id', () => {
    const s = projectScopeOf(projects, 'sub', null)
    expect(s).toMatchObject({ projectId: 'sub', path: A, isAll: false, scopeId: 'pA' })
    expect(s.project?.name).toBe('Sub')
  })
  it('All projects has no folder and no scope', () => {
    expect(projectScopeOf(projects, null, A)).toEqual({ projectId: null, project: undefined, path: null, isAll: true, scopeId: null })
  })
  it('Other, or an id no project has, has no folder and matches no project', () => {
    expect(projectScopeOf(projects, OTHER_WORKSPACE, A)).toMatchObject({ path: null, isAll: false, scopeId: UNKNOWN_PROJECT })
    expect(projectScopeOf(projects, 'gone', A)).toMatchObject({ path: null, isAll: false, scopeId: UNKNOWN_PROJECT })
  })
  it('before the project list is read, a selected project\'s folder is the remembered one', () => {
    expect(projectScopeOf(null, 'pA', A)).toMatchObject({ projectId: 'pA', path: A, scopeId: 'pA' })
    expect(projectScopeOf(null, null, A).path).toBeNull()
  })
  it('the active tab never stands in: the derivation reads the selection only', () => {
    expect(projectScopeOf(projects, 'pA', B).path).toBe(A)
  })
})

describe('selectionAfterFocus: a tab of another project switches the title bar', () => {
  it('moves to the active tab\'s project', () => {
    expect(selectionAfterFocus('pA', 'pB')).toBe('pB')
    expect(selectionAfterFocus(OTHER_WORKSPACE, 'pB')).toBe('pB')
  })
  it('stays on a tab of no project, and on All projects', () => {
    expect(selectionAfterFocus('pA', null)).toBe('pA')
    expect(selectionAfterFocus(null, 'pB')).toBeNull()
  })
})

describe('scopeTree / scopeData / scopeSessions / repoInScope (Inbox, needs-you, status bar, Worktrees)', () => {
  const projects = [{ id: 'pA', path: A, name: 'Astera' }, { id: 'pB', path: B, name: 'Gameful' }, { id: 'sub', path: A, name: 'Sub', parentId: 'pA' }] as unknown as Project[]
  const data = {
    projects,
    jobsByProject: { pA: [{ id: 'jA' }], pB: [{ id: 'jB' }] },
    runs: [{ id: 'rA', jobId: 'jA' }, { id: 'rB', jobId: 'jB' }],
    tasks: [{ id: 'tA', runId: 'rA' }, { id: 'tB', runId: 'rB' }],
    dispatches: [{ taskId: 'tA' }, { taskId: 'tB' }],
    gates: [{ runId: 'rA' }, { runId: 'rB' }],
    escalations: [{ runId: 'rA' }, { runId: 'rB' }],
    worktrees
  } as unknown as WorkspaceData
  it('scopeTree keeps the scoped project; null keeps all; unknown keeps none', () => {
    expect(scopeTree(tree, 'pA').map((p) => p.id)).toEqual(['pA'])
    expect(scopeTree(tree, null)).toHaveLength(2)
    expect(scopeTree(tree, UNKNOWN_PROJECT)).toEqual([])
  })
  it('scopeData drops B\'s plans, runs, tasks, dispatches, questions and escalations', () => {
    const d = scopeData(data, 'pA')
    expect(Object.keys(d.jobsByProject)).toEqual(['pA'])
    expect(d.runs.map((r) => r.id)).toEqual(['rA'])
    expect(d.tasks.map((t) => t.id)).toEqual(['tA'])
    expect(d.dispatches).toHaveLength(1)
    expect(d.gates.map((g) => g.runId)).toEqual(['rA'])
    expect(d.escalations?.map((m) => m.runId)).toEqual(['rA'])
    expect(d.projects.map((p) => p.id)).toEqual(['pA', 'sub'])
    expect(scopeData(data, null)).toBe(data)
  })
  it('scopeSessions counts A\'s sessions; an unknown project counts the no-project ones', () => {
    const ids = workspaceSessionIds(tree, sessions as unknown as { id: string; cwd: string }[], worktrees)
    expect(scopeSessions(sessions, ids, 'pA').map((s) => s.id)).toEqual(['sA'])
    expect(scopeSessions(sessions, ids, UNKNOWN_PROJECT)).toEqual([])
    expect(scopeSessions(sessions, new Map([[OTHER_WORKSPACE, new Set(['sA'])]]), UNKNOWN_PROJECT).map((s) => s.id)).toEqual(['sA'])
    expect(scopeSessions(sessions, ids, null)).toHaveLength(2)
  })
  it('repoInScope shows the open project\'s worktrees only', () => {
    expect(repoInScope(tree, 'pA', A)).toBe(true)
    expect(repoInScope(tree, 'pA', B)).toBe(false)
    expect(repoInScope(tree, null, B)).toBe(true)
  })
})
