// T5: `astera worktrees list|remove` — the logic behind the two commands, called from one thin case in command.ts.
//
// The git facts (dirty, unpushed, in base) and the removal are the Host's (`WorktreesOps`, host/worktrees.ts over
// core/worktrees/cleanupRun.ts); this file decides what to show and what may go. A folder with a live session, one
// with uncommitted changes or one with commits that exist nowhere else is never removed without `--force`, and a live
// one not even with it.
import { isPathWithin } from '../files/tree'
import type { WorktreeRow } from '../worktrees/cleanup'
import type { WorktreeRemoveResult } from '../types'
import { findProject, findProjectContaining } from './projects'
import type { OrchState } from './state'

type Reply = { status: number; body: unknown }

/** What the Host reads and does for these commands. */
export interface WorktreesOps {
  /** Every registered worktree with the facts the ready rule reads. */
  rows(): Promise<WorktreeRow[]>
  /** The plain removal of one registered worktree (`force` as `removeWorktree`). `originCopy`: also delete the branch's
   *  copy on origin once the local branch is gone (a plan branch Astera pushed). */
  remove(id: string, force: boolean, originCopy: boolean): Promise<WorktreeRemoveResult>
}

/** `live`: a session runs there. `dirty`: uncommitted changes or untracked files. `unpushed`: commits nothing else holds.
 *  `orphan`: no plan of this state owns it, or git forgot the folder. A folder git could not read reads as dirty: never removable. `merged`: its plan's work is safe elsewhere,
 *  so it can go. `active`: its plan still works on it. */
export type WorktreeState = 'live' | 'dirty' | 'unpushed' | 'orphan' | 'merged' | 'active'

export interface WorktreeView {
  id: string
  path: string
  branch: string
  base: string
  repo: string
  job?: string
  run?: string
  tasks: string[]
  state: WorktreeState
  /** Removable by `--stale`: `merged`, or a leftover folder git no longer knows (`orphan-dir`). A clean worktree no plan owns
   *  is somebody's own and is never stale. */
  stale: boolean
  createdAt: string
  age: string
  untracked?: string[]
}

/** "3d", "5h", "12m": the age of a folder, for a table. */
export function ageOf(createdAt: string, nowMs: number): string {
  const ms = nowMs - Date.parse(createdAt)
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  if (m < 60 * 48) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / 1440)}d`
}

/** Live wins, then what holds work only here, then who owns the folder. Unknown facts read as dirty: never removable. */
export function stateOfRow(r: WorktreeRow): WorktreeState {
  if (r.live) return 'live'
  if (r.item.status === 'orphan-dir') return 'orphan'
  if (r.dirty === null || r.dirty > 0) return 'dirty'
  const orphan = r.owner === undefined
  if (r.unpushed === null || (r.unpushed > 0 && !(r.owner?.landed || r.inBase === true))) return 'unpushed'
  if (orphan) return 'orphan'
  return r.ready ? 'merged' : 'active'
}

export function viewOf(r: WorktreeRow, nowMs: number): WorktreeView {
  const state = stateOfRow(r)
  return {
    id: r.item.id,
    path: r.item.path,
    branch: r.item.branch,
    base: r.item.baseRef,
    repo: r.item.repoPath,
    ...(r.owner ? { job: r.owner.jobId, run: r.owner.runId } : {}),
    tasks: r.owner?.taskIds ?? [],
    state,
    stale: state === 'merged' || (state === 'orphan' && r.item.status === 'orphan-dir'),
    createdAt: r.item.createdAt,
    age: ageOf(r.item.createdAt, nowMs),
    ...(r.untracked.length > 0 ? { untracked: r.untracked } : {})
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const flag = (v: unknown): boolean => v === true || v === 'true'
const bad = (error: string): Reply => ({ status: 400, body: { error } })

/** `list`: the registered worktrees, optionally one project's, optionally only the stale ones. */
export async function worktreesList(ops: WorktreesOps, s: OrchState, args: Record<string, unknown>, nowMs: number, only?: { run?: string }): Promise<Reply> {
  const scoped = await scopedRows(ops, s, args, only)
  if ('status' in scoped) return scoped
  const views = scoped.rows.map((r) => viewOf(r, nowMs)).filter((v) => !flag(args.stale) || v.stale)
  return { status: 200, body: { worktrees: views } }
}

async function scopedRows(ops: WorktreesOps, s: OrchState, args: Record<string, unknown>, only?: { run?: string }): Promise<{ rows: WorktreeRow[] } | Reply> {
  let rows = await ops.rows()
  if (args.project !== undefined) {
    const given = str(args.project)
    if (given === null) return bad('--project needs a value: a project id or folder (from `projects list`)')
    const project = findProject(s, given) ?? findProjectContaining(s, given)
    if (!project) return { status: 404, body: { error: `no project registered for: ${given}` } }
    rows = rows.filter((r) => isPathWithin(project.path, r.item.repoPath))
  }
  if (only?.run !== undefined) rows = rows.filter((r) => r.owner?.runId === only.run)
  return { rows }
}

export interface RemoveOutcome {
  path: string
  branchDeleted?: boolean
  branchPreserved?: string
  reason?: string
}

/** `remove (--path <p> | --run <runId> | --stale) [--force] [--dry-run]`. Exactly one selector. Without `--force` a
 *  folder that is dirty or unpushed is kept and says why; a live one is kept either way. `--dry-run` removes nothing and
 *  lists what would go. */
export async function worktreesRemove(ops: WorktreesOps, s: OrchState, args: Record<string, unknown>, nowMs: number, only?: { run?: string }): Promise<Reply> {
  const path = str(args.path)
  const run = str(args.run)
  const stale = flag(args.stale)
  if ([path, run, stale ? 'x' : null].filter((x) => x !== null).length !== 1) return bad('worktrees remove takes exactly one of --path, --run and --stale')
  const force = flag(args.force)
  const dryRun = flag(args.dryRun)
  const scoped = await scopedRows(ops, s, args, only)
  if ('status' in scoped) return scoped

  let chosen: WorktreeRow[]
  if (path !== null) {
    chosen = scoped.rows.filter((r) => samePath(r.item.path, path))
    if (chosen.length === 0) return { status: 404, body: { error: `no registered worktree at: ${path}` } }
  } else if (run !== null) {
    if (!s.runs.some((r) => r.id === run)) return { status: 404, body: { error: `unknown run: ${run}` } }
    chosen = scoped.rows.filter((r) => r.owner?.runId === run)
  } else chosen = scoped.rows.filter((r) => viewOf(r, nowMs).stale)

  const removed: RemoveOutcome[] = []
  const kept: RemoveOutcome[] = []
  for (const r of chosen) {
    const state = stateOfRow(r)
    if (r.live) {
      kept.push({ path: r.item.path, reason: 'a session runs in it' })
      continue
    }
    if (!force && (state === 'dirty' || state === 'unpushed')) {
      kept.push({ path: r.item.path, reason: state === 'dirty' ? `${r.dirty ?? 'unknown'} uncommitted change(s); --force removes it` : `${r.unpushed ?? 'unknown'} commit(s) that exist nowhere else; --force removes it` })
      continue
    }
    if (dryRun) {
      removed.push({ path: r.item.path })
      continue
    }
    try {
      const done = await ops.remove(r.item.id, force, r.owner?.pushed === true)
      removed.push({ path: r.item.path, branchDeleted: done.branchDeleted, ...(done.branchPreserved ? { branchPreserved: done.branchPreserved.branch } : {}) })
    } catch (e) {
      kept.push({ path: r.item.path, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return { status: 200, body: { dryRun, [dryRun ? 'wouldRemove' : 'removed']: removed, kept } }
}

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '') === b.replace(/\\/g, '/').replace(/\/+$/, '')
