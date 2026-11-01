import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { WorktreeInfo } from '../types'
import { isSamePath } from '../files/tree'
import { git, listGitWorktrees, GIT_WRITE_TIMEOUT_MS } from './git'
import { isOnBranch, renameToTrash } from './remove'
import type { WorktreeStore } from './registry'

const subdirs = async (p: string): Promise<string[]> =>
  (await fs.readdir(p, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name)

/** Whether the work of a worktree whose folder lost its `.git` is safe in the repository: the HEAD git still records
 *  for it is on a branch (or a backup ref) or in its base; when git has already forgotten the folder, its branch is
 *  still there. Any failure to ask answers no. */
async function workIsKept(w: WorktreeInfo): Promise<boolean> {
  const rows = await listGitWorktrees(w.repoPath).catch(() => null)
  if (!rows) return false
  const head = rows.find((r) => isSamePath(r.path, w.path))?.head
  if (head)
    return (await isOnBranch(w.repoPath, head)) || (await git(['merge-base', '--is-ancestor', head, w.baseRef], { cwd: w.repoPath })).ok
  if (rows.some((r) => isSamePath(r.path, w.path))) return false // listed without a HEAD: nothing to go on
  return (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${w.branch}`], { cwd: w.repoPath })).ok
}

/**
 * Host start, once: the folders under `<root>/<repo>/` an earlier removal left without their `.git` (git deleted the
 * link, then stopped at a locked file). One the registry lists whose work is on a branch is moved to `<root>/.trash`
 * (kept, not deleted: its files may hold changes git can no longer show), git's record of it pruned and its row
 * dropped. Any other is left as it is and named in the log. Never rejects.
 */
export async function sweepHalfRemoved(a: { registry: WorktreeStore; log: (m: string) => void }): Promise<{ trashed: string[]; kept: string[] }> {
  const out = { trashed: [] as string[], kept: [] as string[] }
  try {
    const root = a.registry.getRoot()
    for (const repoDir of await subdirs(root)) {
      if (repoDir === '.trash') continue
      for (const name of await subdirs(path.join(root, repoDir))) {
        const folder = path.join(root, repoDir, name)
        const noGit = await fs.lstat(path.join(folder, '.git')).then(() => false, (e: NodeJS.ErrnoException) => e.code === 'ENOENT')
        if (!noGit) continue
        const w = a.registry.list().find((x) => isSamePath(x.path, folder))
        if (!w || !(await workIsKept(w))) {
          a.log(`worktree sweep: ${folder} has no .git and its work is not known to be on a branch, left as it is`)
          out.kept.push(folder)
          continue
        }
        try {
          const to = await renameToTrash(folder, root)
          await git(['worktree', 'prune'], { cwd: w.repoPath, timeoutMs: GIT_WRITE_TIMEOUT_MS })
          await a.registry.removeEntry(w.id)
          a.log(`worktree sweep: ${folder} had no .git, moved to ${to}`)
          out.trashed.push(folder)
        } catch (err) {
          a.log(`worktree sweep: ${folder} has no .git and could not be moved aside, left (${err instanceof Error ? err.message : String(err)})`)
          out.kept.push(folder)
        }
      }
    }
  } catch (err) {
    a.log(`worktree sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return out
}
