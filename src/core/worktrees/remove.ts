import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorktreeRemoveResult } from '../types'
import { isPathWithin, isSamePath } from '../files/tree'
import { git, gitVersionAtLeast, listGitWorktrees, GIT_WRITE_TIMEOUT_MS } from './git'

/** Options for a call that changes the repository — see GIT_WRITE_TIMEOUT_MS. A `worktree remove`
 *  killed part-way leaves the folder half deleted with git's record of it still in place, so writes
 *  are never cut short at the read default. */
const write = (cwd: string): { cwd: string; timeoutMs: number } => ({ cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })
import type { WorktreeStore } from './registry'
import { askUntilAnswered, defaultActionPresenceCheck, type PresenceCheck } from './presence'
import { detachLinks, type DetachResult } from './detachLinks'

/** What the index says about this worktree: the paths git tracks as symlinks (mode 120000), relative
 *  with `/`, case folded where the file system folds it, and whether it has any submodule (a 160000
 *  entry). null when git could not say. */
async function trackedIndex(worktreePath: string): Promise<{ links: Set<string>; submodules: boolean } | null> {
  const r = await git(['ls-files', '-s', '-z'], { cwd: worktreePath, trim: false })
  if (!r.ok) return null
  const fold = process.platform === 'win32' || process.platform === 'darwin'
  const links = new Set<string>()
  let submodules = false
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    if (rec.startsWith('160000 ')) submodules = true
    if (!rec.startsWith('120000 ')) continue
    const p = rec.slice(tab + 1)
    links.add(fold ? p.toLowerCase() : p)
  }
  return { links, submodules }
}

/** Takes the links out of a worktree before `git worktree remove` runs on it (detachLinks.ts): Git for
 *  Windows' remove deletes through a junction, into the folder outside it points at. Without force,
 *  git's own tracked symlinks are spared: git never follows them, and removing one would make the
 *  worktree dirty and the removal refused, leaving it damaged. Also without force, a worktree with
 *  submodules is refused first (HAS_SUBMODULES): git refuses to remove one without force, and taking
 *  its links out beforehand would only have cost its node_modules links. Throws LINKS_UNVERIFIED when
 *  the walk could not finish; nothing is removed then. */
async function detachBeforeRemove(
  worktreePath: string,
  force: boolean,
  detach: (root: string, opts: { keep?: (rel: string) => boolean }) => Promise<DetachResult>
): Promise<void> {
  let keep: ((rel: string) => boolean) | undefined
  if (!force) {
    const tracked = await trackedIndex(worktreePath)
    if (!tracked)
      throw new Error(`LINKS_UNVERIFIED: git could not list the tracked files, nothing was removed (${worktreePath})`)
    if (tracked.submodules)
      throw new Error(`HAS_SUBMODULES: the worktree has submodules, remove it with force (${worktreePath})`)
    const fold = process.platform === 'win32' || process.platform === 'darwin'
    keep = (rel) => tracked.links.has(fold ? rel.toLowerCase() : rel)
  }
  const r = await detach(worktreePath, keep ? { keep } : {})
  if (!r.ok)
    throw new Error(
      `LINKS_UNVERIFIED: the links in the folder could not all be checked and taken out, nothing was removed (${worktreePath}): ${r.reason}`
    )
}

/** What keeps a worktree from being removed unforced: modified or staged tracked files, and untracked files that are
 *  neither ignored (`git status` leaves those out) nor symlinks. An untracked symlink (the node_modules link Astera
 *  makes, which a `node_modules/` pattern does not ignore because a link is not a directory) holds nothing of its own:
 *  detachLinks takes it out before git removes the folder. `untracked` lists the files that block, first 10 only. */
export async function blockingChanges(worktreePath: string): Promise<{ count: number; untrackedCount: number; untracked: string[] }> {
  const r = await git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], { cwd: worktreePath, trim: false })
  if (!r.ok) throw new Error(`GIT_REMOVE_FAILED: status check failed (${r.stderr})`)
  let count = 0
  let untrackedCount = 0
  const untracked: string[] = []
  for (const rec of r.stdout.split('\0')) {
    if (rec === '') continue
    const rel = rec.slice(3)
    if (rec.startsWith('?? ') && (await fs.lstat(path.join(worktreePath, rel)).then((st) => st.isSymbolicLink(), () => false))) continue
    count++
    if (!rec.startsWith('?? ')) continue
    untrackedCount++
    if (untracked.length < 10) untracked.push(rel)
  }
  return { count, untrackedCount, untracked }
}

/** Dangerous paths: the repo itself, a parent that contains the repo, home, a parent that contains home, the filesystem root */
export function isDangerousRemovalPath(
  worktreePath: string,
  repoPath: string,
  homeDir: string
): boolean {
  const p = path.resolve(worktreePath)
  if (isSamePath(p, repoPath) || isSamePath(p, homeDir)) return true
  if (isPathWithin(p, repoPath) || isPathWithin(p, homeDir)) return true // p is an ancestor of them
  if (isSamePath(p, path.parse(p).root)) return true
  return false
}

/** Proves ownership of an orphaned directory: the gitdir in the .git "file" is under the original repo's .git/worktrees/ */
async function isProvenOrphanDir(worktreePath: string, repoPath: string): Promise<boolean> {
  try {
    const gitFile = path.join(worktreePath, '.git')
    const stat = await fs.lstat(gitFile)
    if (!stat.isFile()) return false
    const m = /^gitdir:\s*(.+)\s*$/m.exec(await fs.readFile(gitFile, 'utf8'))
    if (!m) return false
    const gitdir = path.resolve(worktreePath, m[1].trim())
    const adminRoot = path.join(path.resolve(repoPath), '.git', 'worktrees')
    return isPathWithin(adminRoot, gitdir)
  } catch {
    return false
  }
}

/** Gate for an orphaned directory whose cleanliness cannot be confirmed: git status is unusable (it is
 *  outside the original repo's management) so there is no way to know what changed — if there is even one
 *  entry other than .git it counts as "unverifiable" and force is required (a different question from DIRTY).
 *  .git is skipped because a proven orphan's .git is our own marker; with ownership unproven it has to be
 *  counted (countGitDir), since a .git *directory* means a separate repo rather than a leftover of ours. */
async function countOrphanEntries(
  worktreePath: string,
  opts?: { countGitDir?: boolean }
): Promise<number> {
  try {
    const entries = await fs.readdir(worktreePath)
    return opts?.countGitDir ? entries.length : entries.filter((e) => e !== '.git').length
  } catch (err) {
    // ENOENT (a TOCTOU race after the presence check) and EACCES/EPERM (permission denied) both converge on "unverifiable"
    throw new Error(
      `ORPHAN_UNVERIFIABLE: ${worktreePath} (${err instanceof Error ? err.message : String(err)})`
    )
  }
}

/** Moves a folder git no longer tracks to `<root>/.trash/<name>-<time>`, where the owner can still open it. A failed
 *  move (another drive: EXDEV) throws and nothing is removed. */
async function moveToTrash(folder: string, root: string): Promise<void> {
  try {
    await renameToTrash(folder, root)
  } catch (err) {
    throw new Error(`ORPHAN_NOT_MOVED: ${folder} could not be moved aside, nothing was removed (${err instanceof Error ? err.message : String(err)})`)
  }
}

/** The errors Windows gives while a file in the folder is held open; a rename is tried again on them. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
const codeOf = (err: unknown): string => (err as NodeJS.ErrnoException)?.code ?? ''
/** Waits between attempts to rename a folder into `.trash`: about 5 s in all. */
const RENAME_WAITS_MS = [100, 200, 400, 800, 1500, 2000]
/** Waits between attempts to delete a trashed folder: about 10 minutes in all. */
const DELETE_WAITS_MS = [1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 180_000, 180_000]
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms).unref?.() })

/** The file calls a removal makes; a test seam. */
export interface TrashFs {
  rename(from: string, to: string): Promise<void>
  rm(p: string, opts: { recursive: true; force: true }): Promise<void>
}
const realFs: TrashFs = { rename: (from, to) => fs.rename(from, to), rm: (p, opts) => fs.rm(p, opts) }

/** Renames `folder` to `<root>/.trash/<name>-<time>`, tried again while a held file refuses it (BUSY, about 5 s).
 *  The trash path; the last error is thrown, and the folder is then where it was, whole. */
export async function renameToTrash(folder: string, root: string, f: TrashFs = realFs, waits = RENAME_WAITS_MS): Promise<string> {
  const to = path.join(root, '.trash', `${path.basename(folder)}-${Date.now()}`)
  await fs.mkdir(path.dirname(to), { recursive: true })
  for (let i = 0; ; i++) {
    try {
      await f.rename(folder, to)
      return to
    } catch (err) {
      if (i >= waits.length || !BUSY.has(codeOf(err))) throw err
      await sleep(waits[i]!)
    }
  }
}

/** Deletes a trashed folder, tried again with growing waits (about 10 minutes) while a held file refuses it. Never
 *  rejects: a folder that still cannot go is logged once and left in `.trash`. */
export async function deleteTrash(p: string, log: (m: string) => void = console.warn, f: TrashFs = realFs, waits = DELETE_WAITS_MS): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await f.rm(p, { recursive: true, force: true })
      return
    } catch (err) {
      if (i >= waits.length) {
        log(`trash: could not delete ${p}, left there (${err instanceof Error ? err.message : String(err)})`)
        return
      }
      await sleep(waits[i]!)
    }
  }
}

/** Whether commit `head` is on a branch, or under a backup ref (backupRef): its work survives the folder. */
export async function isOnBranch(repo: string, head: string): Promise<boolean> {
  const r = await git(['for-each-ref', '--count=1', '--format=%(refname)', `--contains=${head}`, 'refs/heads/', 'refs/astera/backup/'], { cwd: repo })
  return r.ok && r.stdout !== ''
}

/** create() makes <root>/<repoDirName> on the way to the worktree, and nothing else ever removed it —
 *  so a repo whose last worktree is gone left an empty directory behind for good. rmdir is not recursive:
 *  a surviving sibling worktree turns this into a silent no-op. The registry root itself is left alone,
 *  since it can be a path the user chose for other things too. */
async function pruneEmptyRepoDir(worktreePath: string, root: string): Promise<void> {
  const parent = path.dirname(path.resolve(worktreePath))
  if (isSamePath(parent, root) || !isPathWithin(root, parent)) return
  await fs.rmdir(parent).catch(() => {}) // ENOTEMPTY / ENOENT / EACCES all mean "leave it"
}

/** The ref the merge check is made against: branch.<b>.base → origin/HEAD → HEAD */
async function mergeTarget(repo: string, branch: string): Promise<string> {
  const cfg = await git(['config', `branch.${branch}.base`], { cwd: repo })
  if (cfg.ok && cfg.stdout) {
    const ok = await git(['rev-parse', '--verify', '--quiet', `${cfg.stdout}^{commit}`], { cwd: repo })
    if (ok.ok) return cfg.stdout
  }
  const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: repo })
  if (head.ok && head.stdout) {
    const ok = await git(['rev-parse', '--verify', '--quiet', `${head.stdout}^{commit}`], { cwd: repo })
    if (ok.ok) return head.stdout
  }
  return 'HEAD'
}

/** Squash-merge detection: merge-tree yields an identical tree (git≥2.38), or cherry reports all '-' */
async function isBranchMerged(repo: string, branch: string): Promise<boolean> {
  const target = await mergeTarget(repo, branch)
  // A tag with the same name would come before the branch in rev precedence and cause a misjudgement, so the full ref is used
  const branchRef = `refs/heads/${branch}`
  if (target.startsWith('refs/remotes/'))
    await git(['fetch', '--prune', 'origin'], { cwd: repo, timeoutMs: 10_000 }) // best-effort, only when the target is remote
  if (await gitVersionAtLeast(2, 38)) {
    const merged = await git(['merge-tree', '--write-tree', target, branchRef], { cwd: repo })
    const targetTree = await git(['rev-parse', `${target}^{tree}`], { cwd: repo })
    if (merged.ok && targetTree.ok && merged.stdout === targetTree.stdout) return true
  }
  const cherry = await git(['cherry', target, branchRef], { cwd: repo })
  if (cherry.ok) {
    const lines = cherry.stdout === '' ? [] : cherry.stdout.split('\n')
    if (lines.every((l) => l.startsWith('-'))) return true // an empty list = no new commits → merged
  }
  return false
}

/** Every commit of the branch is in `base` (a plan branch a Task's branch was merged into, or the base it forked from). */
async function isAncestorOf(repo: string, branch: string, base: string): Promise<boolean> {
  return (await git(['merge-base', '--is-ancestor', `refs/heads/${branch}`, base], { cwd: repo })).ok
}

/** Points `refs/astera/backup/<yyyymmdd-hhmmss>-<what>-<sha7>` at the commit `rev` names, before a step that would lose
 *  it (`reset --hard`, `branch -D`, `push --delete`), and logs it. The ref's name, or null when `rev` names no commit or
 *  the ref could not be written: a caller then skips its destructive step, since nothing would bring the commit back. */
export async function backupRef(
  cwd: string,
  rev: string,
  what: string,
  log: (m: string) => void = console.warn,
  run: typeof git = git
): Promise<string | null> {
  const sha = await run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd })
  if (!sha.ok || sha.stdout === '') return null
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const name = `refs/astera/backup/${stamp}-${what.replace(/[^A-Za-z0-9._-]+/g, '-')}-${sha.stdout.slice(0, 7)}`
  const w = await run(['update-ref', name, sha.stdout], { cwd })
  if (!w.ok) {
    log(`backup: could not write ${name} for ${rev} (${w.stderr}); the step that would lose it is skipped`)
    return null
  }
  log(`backup: ${name} -> ${sha.stdout} (${rev}, before ${what})`)
  return name
}

/** Deletes origin's copy of a branch that is gone locally, when origin has one. Best effort: a failure leaves the copy. */
async function deleteOriginCopy(repo: string, branch: string): Promise<void> {
  if (!(await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: repo })).ok) return
  // A teammate may have pushed to origin's copy since: kept under a backup ref first
  if ((await backupRef(repo, `refs/remotes/origin/${branch}`, `push-delete-${branch}`)) === null) return
  await git(['push', 'origin', '--delete', '--', branch], { cwd: repo, timeoutMs: 30_000 })
}

/** Whether the worktree's folder is there, asked asynchronously and with a time limit, on the
 *  per-root action lane (presence.ts: a check stuck on another drive never refuses this one). A sync
 *  existsSync on a folder on a dead network share froze the calling thread (the Electron main thread,
 *  or the Host's) for 20 to 60 s. **Only `missing` counts as gone**: a timeout or any other error is
 *  "not known", and nothing is deleted on it (the registry entry least of all). A refusal (no call was
 *  made) is asked again a few times (askUntilAnswered); one that lasts is "could not check", which
 *  deletes nothing either. */
/** T22: stops what still runs in the folder, right before it is removed or moved: a process holding it (a server a
 *  worker left, with the folder as its cwd) left the folder half removed. Its own function, so the removal steps around
 *  it can change apart from it. The stopper never throws (host/workspace/processesIn.ts). */
async function stopProcessesBeforeRemoval(folder: string, stop: ((dir: string) => Promise<unknown>) | undefined): Promise<void> {
  await stop?.(folder)
}

async function folderState(p: string, check: PresenceCheck): Promise<'present' | 'missing'> {
  const r = await askUntilAnswered(check, p)
  if (r === 'present' || r === 'missing') return r
  throw new Error(
    r === 'refused'
      ? `WORKTREE_UNREACHABLE: the folder could not be checked just now, nothing was removed (${p})`
      : `WORKTREE_UNREACHABLE: folder not reachable, nothing was removed (${p})`
  )
}

export async function removeWorktree(args: {
  id: string
  force?: boolean
  registry: WorktreeStore
  isPathInUse: (worktreePath: string) => string | null
  /** Also delete the branch's copy on origin (`git push origin --delete`) once the local branch is gone. Only a branch
   *  that was deleted locally is ever deleted there, and that happens only when its work is in its base. */
  deleteRemoteBranch?: boolean
  /** Test seam; defaults to the process-wide action-lane check (presence.ts). */
  presence?: PresenceCheck
  /** Test seam: the link walk before git removes the folder (detachLinks.ts). */
  detach?: (root: string, opts: { keep?: (rel: string) => boolean }) => Promise<DetachResult>
  /** Test seam: the rename into `.trash` and the background delete. */
  fs?: TrashFs
  /** Where the background delete says it gave up; defaults to console.warn. */
  log?: (m: string) => void
  /** Stops the processes still running in the folder before it is removed (the Host's processesIn.ts). Left out,
   *  nothing is stopped. */
  stopProcessesIn?: (dir: string) => Promise<unknown>
}): Promise<WorktreeRemoveResult> {
  const info = args.registry.get(args.id)
  if (!info) throw new Error(`NOT_MANAGED: not a worktree created by this app (${args.id})`)
  const presence = args.presence ?? defaultActionPresenceCheck

  const inUse = args.isPathInUse(info.path)
  if (inUse) throw new Error(`IN_USE: ${inUse}`)
  if (isDangerousRemovalPath(info.path, info.repoPath, os.homedir()))
    throw new Error(`DANGEROUS_PATH: ${info.path}`)

  // Re-query the source of truth — when the repo itself is gone and the directory is gone too, just clean up
  let rows
  try {
    rows = await listGitWorktrees(info.repoPath)
  } catch {
    if ((await folderState(info.path, presence)) === 'missing') {
      await pruneEmptyRepoDir(info.path, args.registry.getRoot())
      await args.registry.removeEntry(args.id)
      return { removed: true, branchDeleted: false }
    }
    throw new Error(`ORPHAN_UNPROVEN: cannot inspect the original repo (${info.repoPath})`)
  }
  const row = rows.find((r) => isSamePath(r.path, info.path))

  let branchDeleted = false
  let branchPreserved: { branch: string; head: string } | undefined

  if (!row) {
    // git has forgotten it
    await git(['worktree', 'prune'], write(info.repoPath))
    if ((await folderState(info.path, presence)) === 'present') {
      const proven = await isProvenOrphanDir(info.path, info.repoPath)
      const entries = await countOrphanEntries(info.path, proven ? undefined : { countGitDir: true })
      // Without proof there is no telling our worktree from an unrelated directory — but an empty one
      // has nothing to lose, and demanding proof there left the row undeletable forever
      if (entries > 0 && !proven) throw new Error(`ORPHAN_UNPROVEN: ownership cannot be proven, so nothing is deleted (${info.path})`)
      if (entries > 0 && !args.force) throw new Error(`ORPHAN_UNVERIFIABLE: ${info.path}`)
      await stopProcessesBeforeRemoval(info.path, args.stopProcessesIn)
      // git cannot say whether its files hold uncommitted work, so force moves the folder aside, never deletes it
      if (entries > 0) await moveToTrash(info.path, args.registry.getRoot())
      try {
        await fs.rm(info.path, { recursive: true, force: true })
      } catch (err) {
        throw new Error(`GIT_REMOVE_FAILED: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else {
    // If the directory is already gone, git status itself is impossible and there is nothing to inspect — skip the cleanliness check.
    // Force or not, the folder is asked about first: before it goes, its links are taken out
    // (detachBeforeRemove — a delete would go through a junction into the folder it points at), and
    // that walk is not run on a folder that did not answer. Unreachable throws; nothing is removed.
    // A locked worktree is refused (git refuses it even with one --force, and prune keeps its entry),
    // before the link walk would have taken its node_modules links out for nothing.
    if (row.locked)
      throw new Error(`WORKTREE_LOCKED: the worktree is locked (git worktree lock), nothing was removed (${info.path})`)
    if ((await folderState(info.path, presence)) === 'present') {
      if (!args.force) {
        const { count } = await blockingChanges(info.path)
        if (count > 0) throw new Error(`DIRTY: ${count}`)
      }
      // A commit no branch holds would be lost with the folder, force or not
      if (row.head && !(await isOnBranch(info.repoPath, row.head)))
        throw new Error(`NOT_ON_BRANCH: its commit ${row.head.slice(0, 7)} is on no branch, nothing was removed (${info.path})`)
      await detachBeforeRemove(info.path, args.force === true, args.detach ?? detachLinks)
      // The processes still using the folder are stopped before it moves
      await stopProcessesBeforeRemoval(info.path, args.stopProcessesIn)
      // Renamed aside, never deleted in place: on Windows git deletes the `.git` link first and then stops at a locked
      // file, which left a whole checkout without its `.git`. A rename moves all of it or nothing.
      const f = args.fs ?? realFs
      let trash: string | null = null
      try {
        trash = await renameToTrash(info.path, args.registry.getRoot(), f)
      } catch (err) {
        if (BUSY.has(codeOf(err)))
          throw new Error(`WORKTREE_BUSY: a file in the folder is held open, it was left whole with its .git (${info.path}): ${err instanceof Error ? err.message : String(err)}`)
        // Not a held file (another drive: EXDEV): git removes it in place
        const rm = await git(
          args.force ? ['worktree', 'remove', '--force', info.path] : ['worktree', 'remove', info.path],
          write(info.repoPath)
        )
        if (!rm.ok) throw new Error(`GIT_REMOVE_FAILED: ${rm.stderr || rm.stdout}`)
      }
      if (trash !== null) void deleteTrash(trash, args.log, f)
    }
    // The moved (or missing) folder's admin entry is stale now: prune drops it
    await git(['worktree', 'prune'], write(info.repoPath))
  }

  // Branch deletion: -d → squash detection → -D; on failure the branch is preserved
  const del = await git(['branch', '-d', '--', info.branch], write(info.repoPath))
  if (del.ok) branchDeleted = true
  else if ((await isBranchMerged(info.repoPath, info.branch)) || (await isAncestorOf(info.repoPath, info.branch, info.baseRef))) {
    if ((await backupRef(info.repoPath, `refs/heads/${info.branch}`, `branch-D-${info.branch}`)) !== null)
      branchDeleted = (await git(['branch', '-D', '--', info.branch], write(info.repoPath))).ok
  }
  if (branchDeleted && args.deleteRemoteBranch) await deleteOriginCopy(info.repoPath, info.branch)
  if (!branchDeleted) {
    const head = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`], {
      cwd: info.repoPath
    })
    if (head.ok) branchPreserved = { branch: info.branch, head: head.stdout }
  }

  await pruneEmptyRepoDir(info.path, args.registry.getRoot())
  await args.registry.removeEntry(args.id)
  return { removed: true, branchDeleted, ...(branchPreserved ? { branchPreserved } : {}) }
}
