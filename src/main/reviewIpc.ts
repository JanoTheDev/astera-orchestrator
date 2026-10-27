// The review IPCs: the change map of a worktree against its base, and merging its pull request. They sit in their own
// file so ipc.ts stays untouched; `registerReviewIpc` is called from index.ts with the same registry and project list
// ipc.ts's worktree handlers read.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isPathWithin, isSamePath } from '../core/files/tree'
import { defaultGhRunner, ghFailureSentence, type GhRunner } from '../core/github/gh'
import { listOpenPrs } from '../core/github/prList'
import type { OpenPrsResult } from '../core/github/types'
import { mergePullRequest, PR_MERGE_METHODS, type PrMergeRequest, type PrMergeResult } from '../core/github/prMerge'
import { buildChangeMap, CHANGE_MAP_MAX_BYTES, CONTENT_TOO_LARGE, parseUnifiedDiff, type ChangeMap, type ReadNew } from '../core/review/changeMap'
import { detectBaseRef, git as runGit } from '../core/worktrees/git'

export interface ReviewDeps {
  /** Registered worktrees: a path in this list is a worktree, and its `baseRef` is the base the app made it from. */
  worktrees: () => Array<{ path: string; baseRef: string }>
  projectPaths: () => Promise<string[]>
  git?: typeof runGit
  detectBase?: (cwd: string) => Promise<string | null>
  merge?: (req: PrMergeRequest) => Promise<PrMergeResult>
  gh?: GhRunner
}

/** Same rule as `worktrees.detail`: only a folder the app knows (a registered worktree or a project) is read or merged. */
export async function isKnownCwd(cwd: unknown, deps: Pick<ReviewDeps, 'worktrees' | 'projectPaths'>): Promise<boolean> {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false
  if (deps.worktrees().some((w) => isSamePath(w.path, cwd))) return true
  return (await deps.projectPaths()).some((p) => isSamePath(p, cwd))
}

/** A recorded or caller-given base can start with `-`: it is a revision, never an option. */
const safeRev = (r: unknown): r is string => typeof r === 'string' && r !== '' && !r.startsWith('-')

/** The file's new text from the working folder, read only when it is a plain file within the limit. */
export function readNewFrom(root: string): (rel: string) => Promise<ReturnType<ReadNew>> {
  return async (rel) => {
    const abs = path.join(root, rel)
    if (!isPathWithin(root, abs)) return null
    try {
      const st = await fs.lstat(abs)
      if (!st.isFile()) return null
      if (st.size > CHANGE_MAP_MAX_BYTES) return CONTENT_TOO_LARGE
      return await fs.readFile(abs, 'utf8')
    } catch {
      return null
    }
  }
}

/** `base...HEAD`, the committed work since the fork point: the same range `worktrees.detail` lists (it does not include
 *  uncommitted edits either). Null when git cannot answer. */
export async function changeMapOf(cwd: string, base: string, deps: Pick<ReviewDeps, 'git'> = {}): Promise<ChangeMap | null> {
  const git = deps.git ?? runGit
  const r = await git(
    ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '-U3', '--end-of-options', `${base}...HEAD`, '--'],
    { cwd, trim: false }
  )
  if (!r.ok) return null
  const read = readNewFrom(cwd)
  const texts = new Map<string, ReturnType<ReadNew>>()
  for (const f of parseUnifiedDiff(r.stdout)) if (f.status !== 'deleted' && !f.binary) texts.set(f.path, await read(f.path))
  return buildChangeMap(r.stdout, (p) => texts.get(p))
}

export function registerReviewIpc(
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void },
  deps: ReviewDeps
): void {
  ipcMain.handle('review.changeMap', async (_e, opts: unknown) => {
    const o = (opts ?? {}) as { cwd?: unknown; base?: unknown }
    if (!(await isKnownCwd(o.cwd, deps))) return null
    const cwd = o.cwd as string
    const base = safeRev(o.base)
      ? o.base
      : (deps.worktrees().find((w) => isSamePath(w.path, cwd))?.baseRef ?? (await (deps.detectBase ?? detectBaseRef)(cwd)))
    return safeRev(base) ? changeMapOf(cwd, base, deps) : null
  })
  ipcMain.handle('pr.merge', async (_e, req: unknown): Promise<PrMergeResult> => {
    const r = (req ?? {}) as Partial<Record<keyof PrMergeRequest, unknown>>
    if (!(await isKnownCwd(r.cwd, deps))) return { ok: false, kind: 'other', detail: 'not a known worktree or project folder' }
    if (!(PR_MERGE_METHODS as readonly unknown[]).includes(r.method)) return { ok: false, kind: 'other', detail: 'unknown merge method' }
    const number = typeof r.number === 'number' && Number.isInteger(r.number) && r.number > 0 ? r.number : undefined
    const branch = typeof r.branch === 'string' ? r.branch : undefined
    return (deps.merge ?? mergePullRequest)({
      cwd: r.cwd as string,
      method: r.method as PrMergeRequest['method'],
      ...(number !== undefined ? { number } : { branch }),
      ...(r.deleteBranch === true ? { deleteBranch: true } : {})
    })
  })
  ipcMain.handle('pr.listOpen', async (_e, req: unknown): Promise<OpenPrsResult> => {
    const cwd = ((req ?? {}) as { cwd?: unknown }).cwd
    if (!(await isKnownCwd(cwd, deps))) return { ok: false, kind: 'error', message: 'not a known worktree or project folder' }
    return listOpenPrs(deps.gh ?? defaultGhRunner, cwd as string)
  })
}
