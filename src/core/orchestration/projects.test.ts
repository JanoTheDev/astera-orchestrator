import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createJob, createTask, emptyState, startJobRun } from './state'
import { dropNonGitProjects, ensureGitProject, ensureProject, findProject, findProjectByPath, nameFromPath, renameProject, setProjectSettings } from './projects'
import { addSubProject, autoProjectFor, childProjectsOf, findProjectContaining, moveJobToProject, projectOfJob, removeProject } from './projects'
import type { Project } from './types'
import { foldsCaseHere } from '../testPaths'

/** An absolute path this platform actually produces, so the case and separator rules under test are
 *  the real ones rather than a win32 string a posix runner never sees. */
const abs = (...parts: string[]): string => path.resolve(path.sep, ...parts)

describe('nameFromPath', () => {
  it('takes the last segment whichever separator the path was written with', () => {
    expect(nameFromPath('D:\\work\\astera')).toBe('astera')
    expect(nameFromPath('/home/me/astera')).toBe('astera')
  })

  // A trailing separator would otherwise name the project the empty string, and an empty name is
  // what a person sees in the list.
  it('ignores a trailing separator', () => {
    expect(nameFromPath('D:\\work\\astera\\')).toBe('astera')
    expect(nameFromPath('/home/me/astera/')).toBe('astera')
  })
})

describe('ensureProject', () => {
  it('registers a project with a name taken from the folder', () => {
    const { state, project } = ensureProject(emptyState(), { path: abs('work', 'astera'), now: 'T0' })
    expect(project).toMatchObject({ path: abs('work', 'astera'), name: 'astera', addedAt: 'T0' })
    expect(project.id).toMatch(/^proj_/)
    expect(state.projects).toHaveLength(1)
  })

  // The caller is `orch.list`, which runs every time the Jobs sidebar is shown. If this grew the
  // array each time, opening a project twice would register it twice.
  it('answers with the existing project and the same state object when it is already registered', () => {
    const first = ensureProject(emptyState(), { path: abs('work', 'astera'), now: 'T0' })
    const second = ensureProject(first.state, { path: abs('work', 'astera'), now: 'T1' })
    expect(second.project.id).toBe(first.project.id)
    expect(second.state.projects).toHaveLength(1)
    // Identity, not just equality: the wiring skips its save when nothing changed.
    expect(second.state).toBe(first.state)
  })

  // The same repository arrives spelled differently — the renderer sends the active tab's cwd and
  // win32 ignores case. Two entries for one repository would give the CLI two ids for one thing.
  // Case is folded only where the filesystem ignores it (win32, darwin); on linux a differently cased
  // path is another folder, so it finds nothing.
  it('matches a path that differs only in case where the platform folds case', () => {
    const first = ensureProject(emptyState(), { path: abs('Work', 'Astera'), now: 'T0' })
    const again = findProjectByPath(first.state, abs('Work', 'Astera').toLowerCase())
    expect(again?.id).toBe(foldsCaseHere ? first.project.id : undefined)
  })

  it('keeps separate entries for sibling folders that share a prefix', () => {
    const one = ensureProject(emptyState(), { path: abs('work', 'proj'), now: 'T0' })
    const two = ensureProject(one.state, { path: abs('work', 'proj2'), now: 'T1' })
    expect(two.state.projects).toHaveLength(2)
    expect(two.project.id).not.toBe(one.project.id)
  })
})

describe('renameProject', () => {
  it('changes the name and leaves the path alone', () => {
    const { state, project } = ensureProject(emptyState(), { path: abs('work', 'astera'), now: 'T0' })
    const r = renameProject(state, project.id, '  Astera (main)  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.name).toBe('Astera (main)')
    expect(r.value.path).toBe(project.path)
    expect(findProject(r.state, project.id)?.name).toBe('Astera (main)')
  })

  it('refuses a blank name and an unknown id', () => {
    const { state, project } = ensureProject(emptyState(), { path: abs('work', 'astera'), now: 'T0' })
    expect(renameProject(state, project.id, '   ').ok).toBe(false)
    expect(renameProject(state, 'proj_nope', 'x').ok).toBe(false)
  })
})

// W7-B: the per-project settings `projects-set` writes, and what a new Job and Task of the project take from them.
describe('setProjectSettings (W7-B)', () => {
  const registered = () => ensureProject(emptyState(), { path: abs('work', 'shop'), now: 'T0' })

  it('sets each field, keeps what is left out, and clears what is null', () => {
    const { state, project } = registered()
    const set = setProjectSettings(state, project.id, { autoApprove: true, testConfigId: 'astera:test', concurrency: 10, reviewRounds: 2, replan: 'off', defaultBranch: 'main' })
    if (!set.ok) throw new Error(set.error)
    expect(set.value).toMatchObject({ autoApprove: true, testConfigId: 'astera:test', concurrency: 10, reviewRounds: 2, replan: 'off', defaultBranch: 'main' })
    expect(set.state.projects).toEqual([set.value])
    const cleared = setProjectSettings(set.state, project.id, { concurrency: null, replan: null, testConfigId: null })
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.value).not.toHaveProperty('concurrency')
    expect(cleared.value).not.toHaveProperty('replan')
    expect(cleared.value).not.toHaveProperty('testConfigId')
    expect(cleared.value).toMatchObject({ autoApprove: true, reviewRounds: 2, defaultBranch: 'main', name: 'shop' })
  })

  it('refuses an out-of-range concurrency, zero review rounds, a bad replan and an unknown project', () => {
    const { state, project } = registered()
    for (const patch of [{ concurrency: 0 }, { concurrency: 11 }, { concurrency: 2.5 }, { reviewRounds: 0 }, { replan: 'later' as never }]) {
      const r = setProjectSettings(state, project.id, patch)
      expect(r.ok).toBe(false)
    }
    expect(setProjectSettings(state, 'proj_nope', { concurrency: 2 })).toEqual({ ok: false, error: 'unknown project: proj_nope' })
  })
})

describe('a new Job and Task take their project settings (W7-B)', () => {
  const withSettings = (patch: Parameters<typeof setProjectSettings>[2]) => {
    const { state, project } = ensureProject(emptyState(), { path: abs('work', 'shop'), now: 'T0' })
    const set = setProjectSettings(state, project.id, patch)
    if (!set.ok) throw new Error(set.error)
    return { state: set.state, projectId: project.id }
  }
  const job = (s: ReturnType<typeof withSettings>, over: Partial<Parameters<typeof createJob>[1]> = {}) => {
    const r = createJob(s.state, { objective: 'Ship', cwd: abs('work', 'shop'), projectId: s.projectId, ...over }, 'T1')
    if (!r.ok) throw new Error(r.error)
    return r
  }

  it("fills the Job's concurrency, replan and review rounds from the project", () => {
    const s = withSettings({ concurrency: 7, replan: 'off', reviewRounds: 2 })
    expect(job(s, { convergence: { maxFixAttempts: 3 } }).value).toMatchObject({ concurrency: 7, replan: 'off', convergence: { maxFixAttempts: 3, maxReviewRounds: 2 } })
  })

  it('keeps what the Job gives itself, and adds no convergence the Job did not ask for', () => {
    const s = withSettings({ concurrency: 7, replan: 'off', reviewRounds: 2 })
    const own = job(s, { concurrency: 1, replan: 'waves', convergence: { maxReviewRounds: 4 } }).value
    expect(own.concurrency).toBe(1)
    expect(own.replan).toBeUndefined()
    expect(own.convergence).toEqual({ maxReviewRounds: 4 })
    expect(job(s).value).not.toHaveProperty('convergence')
  })

  it('writes nothing for a project with no settings: the defaults stay unwritten', () => {
    const v = job(withSettings({}), { convergence: {} }).value
    expect(v).not.toHaveProperty('concurrency')
    expect(v).not.toHaveProperty('replan')
    expect(v.convergence).toEqual({})
  })

  it("validates a Task that names no check with the project's test configuration", () => {
    const s = withSettings({ testConfigId: 'astera:test' })
    const j = job(s)
    const def = createTask(j.state, { jobId: j.value.id, title: 'a', spec: 's', deps: [] }, 'T2')
    if (!def.ok) throw new Error(def.error)
    expect(def.value.validateConfigIds).toEqual(['astera:test'])
    const run = startJobRun(def.state, j.value.id, 'T3')
    if (!run.ok) throw new Error(run.error)
    const inst = createTask(run.state, { runId: run.value.id, title: 'b', spec: 's', deps: [] }, 'T4')
    if (!inst.ok) throw new Error(inst.error)
    expect(inst.value.validateConfigIds).toEqual(['astera:test'])
    const named = createTask(run.state, { runId: run.value.id, title: 'c', spec: 's', deps: [], validateConfigIds: ['lint'] }, 'T4')
    if (!named.ok) throw new Error(named.error)
    expect(named.value.validateConfigIds).toEqual(['lint'])
    const single = createTask(run.state, { runId: run.value.id, title: 'd', spec: 's', deps: [], validateConfigId: 'lint' }, 'T4')
    if (!single.ok) throw new Error(single.error)
    expect(single.value.validateConfigIds ?? []).not.toContain('astera:test')
  })

  it('gives no check when the project has no test configuration', () => {
    const j = job(withSettings({}))
    const t = createTask(j.state, { jobId: j.value.id, title: 'a', spec: 's', deps: [] }, 'T2')
    if (!t.ok) throw new Error(t.error)
    expect(t.value.validateConfigIds).toBeUndefined()
  })
})

describe('non-git tab folders (W8-G #103)', () => {
  const now = '2026-10-18T00:00:00Z'
  it('registers a tab folder only when it is a git folder', async () => {
    const s = emptyState()
    expect((await ensureGitProject(s, { path: abs('tmp', 'x'), now }, async () => null)).projects).toEqual([])
    expect((await ensureGitProject(s, { path: abs('tmp', 'repo'), now }, async (d) => d)).projects).toHaveLength(1)
  })

  it('drops non-git projects that hold no plan, and keeps git ones and ones with a plan', async () => {
    let s = emptyState()
    for (const n of ['stray', 'repo', 'planned']) s = ensureProject(s, { path: abs('tmp', n), now }).state
    const made = createJob(s, { cwd: abs('tmp', 'planned'), objective: 'o' }, now)
    if (!made.ok) throw new Error(made.error)
    s = made.state
    const kept = await dropNonGitProjects(s, async (d) => d.endsWith('repo'))
    expect(kept.projects.map((p) => p.name)).toEqual(['repo', 'planned'])
  })
})

// ── T3 workspaces ──
describe('workspaces: sub-projects of one repository (T3)', () => {
  const now = '2026-10-20T00:00:00Z'
  const repo = abs('work', 'astera')
  const root = () => ensureProject(emptyState(), { path: repo, now })
  const ok = <T>(r: { ok: true; state: ReturnType<typeof emptyState>; value: T } | { ok: false; error: string }) => {
    if (!r.ok) throw new Error(r.error)
    return r
  }
  /** A workspace, and a not-started plan of it with one definition Task at `paths`. */
  const withPlan = (paths: string[] = [], over: Partial<Project> = {}) => {
    const { state, project } = root()
    const s0 = { ...state, projects: state.projects.map((p) => ({ ...p, ...over })) }
    const made = ok(createJob(s0, { cwd: repo, objective: 'o', projectId: project.id }, now))
    const pending = { ...made.state, jobs: made.state.jobs.map((j) => ({ ...j, pendingStart: true })) }
    const t = ok(createTask(pending, { jobId: made.value.id, title: 't', spec: 's', deps: [], affectedPaths: paths }, now))
    return { s: t.state, rootId: project.id, jobId: made.value.id }
  }

  it('adds a sub-project on the workspace path, answers it again by name, and refuses a nested one', () => {
    const { state, project } = root()
    const ui = ok(addSubProject(state, { parentId: project.id, name: 'ui', focus: ['src/renderer', ' ', 'src/renderer'], now }))
    expect(ui.value).toMatchObject({ path: repo, name: 'ui', parentId: project.id, focus: ['src/renderer'] })
    expect(ok(addSubProject(ui.state, { parentId: project.id, name: 'UI', now })).value.id).toBe(ui.value.id)
    expect(addSubProject(ui.state, { parentId: ui.value.id, name: 'x', now })).toMatchObject({ ok: false })
    expect(addSubProject(ui.state, { parentId: 'nope', name: 'x', now })).toMatchObject({ ok: false, missing: true })
    // the path questions answer the workspace, never the child
    expect(findProjectByPath(ui.state, repo)?.id).toBe(project.id)
    expect(findProjectContaining(ui.state, path.join(repo, 'src'))?.id).toBe(project.id)
  })

  it('a sub-project reads the settings it leaves unset from its workspace', () => {
    const { s, rootId, jobId } = withPlan([], { handsOff: true, delivery: 'push' })
    const ui = ok(addSubProject(s, { parentId: rootId, name: 'ui', now }))
    const moved = ok(moveJobToProject(ui.state, jobId, ui.value.id))
    expect(projectOfJob(moved.state, moved.value)).toMatchObject({ id: ui.value.id, handsOff: true, delivery: 'push' })
  })

  it('removes a project only without active plans or sub-projects', () => {
    const { s, rootId, jobId } = withPlan()
    const ui = ok(addSubProject(s, { parentId: rootId, name: 'ui', now }))
    expect(removeProject(ui.state, rootId)).toMatchObject({ ok: false })
    const moved = ok(moveJobToProject(ui.state, jobId, ui.value.id))
    expect(removeProject(moved.state, ui.value.id)).toMatchObject({ ok: false })
    const archived = { ...moved.state, jobs: moved.state.jobs.map((j) => ({ ...j, archivedAt: now })) }
    const gone = ok(removeProject(archived, ui.value.id))
    expect(gone.state.projects.map((p) => p.id)).toEqual([rootId])
    expect(removeProject(gone.state, 'nope')).toMatchObject({ ok: false, missing: true })
  })

  it('moves only a plan not started, and only inside its workspace', () => {
    const { s, rootId, jobId } = withPlan()
    const other = ensureProject(s, { path: abs('work', 'other'), now })
    expect(moveJobToProject(other.state, jobId, other.project.id)).toMatchObject({ ok: false })
    const ui = ok(addSubProject(other.state, { parentId: rootId, name: 'ui', now }))
    const started = { ...ui.state, jobs: ui.state.jobs.map((j) => ({ ...j, pendingStart: false })) }
    expect(moveJobToProject(started, jobId, ui.value.id)).toMatchObject({ ok: false })
    expect(ok(moveJobToProject(ui.state, jobId, ui.value.id)).value.projectId).toBe(ui.value.id)
  })

  it('autoProjectFor files plans by first area: two ui plans share one child, orch gets another, off makes none', () => {
    const { s, rootId, jobId } = withPlan(['src/renderer/a.tsx', 'README.md'])
    const tasksOf = (st: typeof s, id: string) => st.tasks.filter((t) => t.jobId === id)
    const a = autoProjectFor(s, s.jobs[0], 'ui', tasksOf(s, jobId), now)
    const ui = childProjectsOf(a, rootId)
    expect(ui).toMatchObject([{ name: 'ui', parentId: rootId, focus: ['src'] }])
    expect(a.jobs[0].projectId).toBe(ui[0].id)
    const second = ok(createJob(a, { cwd: repo, objective: 'o2', projectId: rootId }, now))
    const b = autoProjectFor(second.state, second.value, 'ui', [], now)
    expect(childProjectsOf(b, rootId)).toHaveLength(1)
    expect(b.jobs.find((j) => j.id === second.value.id)?.projectId).toBe(ui[0].id)
    const third = ok(createJob(b, { cwd: repo, objective: 'o3', projectId: rootId }, now))
    const c = autoProjectFor(third.state, third.value, 'orch', [], now)
    expect(childProjectsOf(c, rootId).map((p) => p.name)).toEqual(['ui', 'orch'])
    const off = withPlan([], { autoProjects: false })
    expect(autoProjectFor(off.s, off.s.jobs[0], 'ui', [], now)).toBe(off.s)
  })

  it('a tab in a subfolder or a linked worktree registers the repository, once', async () => {
    const top = abs('work', 'repo')
    const rootOf = async (d: string): Promise<string | null> => (d.startsWith(top) ? top : null)
    const fromSub = await ensureGitProject(emptyState(), { path: path.join(top, 'src', 'deep'), now }, rootOf)
    expect(fromSub.projects.map((p) => p.path)).toEqual([top])
    const fromWorktree = await ensureGitProject(emptyState(), { path: path.join(top, '.claude', 'worktrees', 'x'), now }, rootOf)
    expect(fromWorktree.projects.map((p) => p.path)).toEqual([top])
    // already held by a registered project: nothing new, and git is not asked
    expect(await ensureGitProject(fromSub, { path: path.join(top, '.claude', 'worktrees', 'x'), now }, async () => { throw new Error('asked') })).toBe(fromSub)
  })
})
