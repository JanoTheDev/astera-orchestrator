import { useEffect, useState } from 'react'
import type { Dispatch, Gate, Job, JobRun, Message, Project, Task } from '../../../core/orchestration/types'
import { sameOrNext } from '../lib/remoteSessions'
import { createSharedPoll } from './sharedPoll'
import { workspacesOf, type WorkspaceData, type WorktreeRef } from './workspaceTree'

/** How often the tree is checked while it is wanted. A turn first asks main's state generation (cheap) and reads every
 *  list only when it moved; 'orch:moved' reads at once. */
const POLL_MS = 5000
/** However still the generation stays, the lists are read whole this often: the worktree registry and anything else
 *  outside main's orchestration state is caught here. */
export const FULL_READ_MS = 30_000
/** One list's read past this answers nothing this turn (the part held is kept), so one stuck call does not hold the
 *  others back. */
export const PART_DEADLINE_MS = 20_000

/** What the tree is read through: the window's api, or a test's. */
export interface WorkspaceApi {
  command(projectPath: string, cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  homeDir(): Promise<string | null>
  worktreePaths(): Promise<WorktreeRef[]>
  generation(): Promise<number>
  onMoved(cb: () => void): () => void
}

const windowApi = (): WorkspaceApi => ({
  command: (projectPath, cmd, args) => window.api.orch.command(projectPath, cmd, args),
  homeDir: () => window.api.system.homeDir(),
  worktreePaths: () => window.api.worktrees.paths(),
  generation: () => window.api.orch.generation(),
  onMoved: (cb) => window.api.on('orch:moved', () => cb())
})

const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })

const reader =
  (api: WorkspaceApi, partMs: number) =>
  async <T>(projectPath: string, cmd: string, args: Record<string, unknown> = {}): Promise<T | null> =>
    within(
      api.command(projectPath, cmd, args).then((r) => (r.status === 200 ? (r.body as T) : null)),
      partMs,
      null
    )

/** The new read with every part that did not change replaced by the one already held, and `prev` itself when none
 *  changed: a tick that finds nothing new renders nothing, and the memos derived from one list keep their inputs. */
export function keepUnchanged(prev: WorkspaceData | undefined, next: WorkspaceData): WorkspaceData {
  if (!prev) return next
  const p = prev as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const keys = Object.keys(next)
  let same = keys.length === Object.keys(prev).length
  for (const k of keys) {
    const n = (next as unknown as Record<string, unknown>)[k]
    let v: unknown
    if (k === 'jobsByProject') {
      const old = prev.jobsByProject
      const lists: Record<string, Job[]> = {}
      for (const [id, jobs] of Object.entries(next.jobsByProject)) lists[id] = sameOrNext(old[id] ?? null, jobs)
      v = Object.keys(lists).length === Object.keys(old).length && Object.entries(lists).every(([id, l]) => l === old[id]) ? old : lists
    } else {
      v = sameOrNext(p[k] ?? null, n)
    }
    out[k] = v
    if (v !== p[k]) same = false
  }
  return same ? prev : (out as unknown as WorkspaceData)
}

/** One poll per anchor for the whole window: the top bar and the Agents page read the same tree. */
const workspacePoll = createSharedPoll<WorkspaceData>(POLL_MS)

/**
 * One read of every list. **A list that could not be read keeps the one held** (`prev`) rather than costing the read
 * its others: a Gate answered from the CLI leaves `gates` even while another list times out behind a busy Host. Only
 * with nothing held does a missing list leave the read empty-handed (undefined), as before.
 */
export async function readWorkspace(
  anchorProp: string | null,
  prev?: WorkspaceData,
  api: WorkspaceApi = windowApi(),
  partMs = PART_DEADLINE_MS
): Promise<WorkspaceData | undefined> {
  const read = reader(api, partMs)
  // W7-F (#78): with no open project or session there is no anchor, which left the tree empty ("No projects yet")
  // although projects are registered. The home folder is a path the app may name, so it opens the same door.
  const anchor = anchorProp ?? (await within(api.homeDir(), partMs, null))
  if (!anchor) return undefined
  const listed = await read<Project[]>(anchor, 'projects-list')
  const projects = listed ? workspacesOf(listed) : prev?.projects
  if (!projects) return undefined
  const [jobLists, runs, tasks, dispatches, gates, escalations, worktrees] = await Promise.all([
    Promise.all(projects.map((p) => read<Job[]>(anchor, 'jobs-list', { project: p.path, archived: true }))),
    read<JobRun[]>(anchor, 'runs-list'),
    read<Task[]>(anchor, 'tasks-list', { brief: true }),
    read<Dispatch[]>(anchor, 'dispatches-list'),
    read<Gate[]>(anchor, 'questions-list', { status: 'open' }),
    read<Message[]>(anchor, 'inbox', { type: 'escalation', limit: 500 }), // W6-B
    // W6-F: where each worktree is and which repo it came from; without them a worktree's tabs are "Other". The
    // registry as main holds it (worktrees.paths): `worktrees.list` runs git and the Host for every entry.
    within(api.worktreePaths(), partMs, null as WorktreeRef[] | null)
  ])
  const part = <T>(fresh: T | null, held: T | undefined): T | undefined => fresh ?? held
  const r = part(runs, prev?.runs)
  const t = part(tasks, prev?.tasks)
  const d = part(dispatches, prev?.dispatches)
  const g = part(gates, prev?.gates)
  if (!r || !t || !d || !g) return undefined
  const jobsByProject: Record<string, Job[]> = {}
  projects.forEach((p, i) => {
    jobsByProject[p.id] = jobLists[i] ?? prev?.jobsByProject[p.id] ?? []
  })
  const e = part(escalations, prev?.escalations)
  return { projects, jobsByProject, runs: r, tasks: t, dispatches: d, gates: g, worktrees: worktrees ?? prev?.worktrees ?? [], ...(e ? { escalations: e } : {}) }
}

/** The poll's source for one anchor: the whole read, checked first against main's state generation, and read again
 *  at once on 'orch:moved' (a Host push, the refill after a reconnect). */
export function workspaceSource(anchorProp: string | null, api: WorkspaceApi = windowApi()) {
  return {
    read: (prev?: WorkspaceData) => readWorkspace(anchorProp, prev, api),
    merge: keepUnchanged,
    probe: { key: () => api.generation(), maxAgeMs: FULL_READ_MS },
    signals: (reload: () => void) => api.onMoved(reload)
  }
}

/**
 * Every project's plans, runs, tasks, dispatches and open Gates, through the same door the CLI uses (`orch.command`)
 * — read only. `anchor` is any path the app may name (a session's cwd or the open project), which these unscoped
 * reads need as their door argument.
 *
 * W3-C: Dispatches come from one unscoped `dispatches-list`, so every project's sessions refresh on every tick. (W2-B
 * read them per Task with `dispatch-show`, which is owner checked against the project the Jobs view watches, so other
 * projects' sessions went stale.) An account roll rekeys a Dispatch to its new session without moving the Task, and
 * this read sees that too.
 */
export function useWorkspaceData(anchorProp: string | null, enabled: boolean, refreshKey = 0): WorkspaceData | null {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const key = anchorProp ?? ''
  useEffect(() => {
    if (!enabled) return
    return workspacePoll.subscribe(key, workspaceSource(anchorProp), setData)
    // `key` stands for the anchor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  useEffect(() => {
    if (refreshKey > 0) workspacePoll.reload(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  return data
}
