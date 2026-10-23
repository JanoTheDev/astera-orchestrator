import { describe, expect, it } from 'vitest'
import type { Project } from '../../../core/orchestration/types'
import type { WallInput } from '../components/wall/wallModel'
import { repoInScope, scopeData, scopeIdOf, scopeSessions, scopeTree, UNKNOWN_PROJECT } from './projectView'
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

describe('scopeIdOf: the window\'s project, never an exact path match', () => {
  it('uses the window project when it is known', () => {
    expect(scopeIdOf(tree, worktrees, 'pA', B, false)).toBe('pA')
  })
  it('an active tab in a worktree of A scopes to A', () => {
    expect(scopeIdOf(tree, worktrees, null, '/home/jonx/astera-worktrees/Astera/first/src', false)).toBe('pA')
  })
  it('a folder no project holds, or no folder, matches no project; All projects is the only null', () => {
    expect(scopeIdOf(tree, worktrees, null, '/tmp/x', false)).toBe(UNKNOWN_PROJECT)
    expect(scopeIdOf(tree, worktrees, null, null, false)).toBe(UNKNOWN_PROJECT)
    expect(scopeIdOf(tree, worktrees, 'pA', A, true)).toBeNull()
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
