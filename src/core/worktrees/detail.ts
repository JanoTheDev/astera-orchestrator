// W9-J: what the Worktrees page's detail shows for one worktree: the files it changed against its base (DiffView reads
// one file's diff by the id this list gave) and the commits since the base, each with the W8 author. Read-only git.
import type { WorktreeCommit, WorktreeDetail } from './cleanup'
import { readChanges, readFileDiff } from '../git/changes'
import { kindOf, notesIndex, readNote } from '../attribution/note'
import { git } from './git'

/** Commits of HEAD since `base` (newest first, at most 100), authors from the notes. */
async function commitsSince(path: string, base: string): Promise<WorktreeCommit[] | null> {
  const r = await git(['log', '--max-count=100', '--format=%H%x1f%an%x1f%s', `${base}..HEAD`], { cwd: path })
  if (!r.ok) return null
  const index = await notesIndex(path)
  const out: WorktreeCommit[] = []
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [sha, author, subject] = line.split('\x1f')
    const note = await readNote(path, sha, undefined, index)
    out.push({
      sha,
      subject: subject ?? '',
      author: author ?? '',
      kind: kindOf(note),
      ...(note && note !== 'unknown' && !note.human ? { agent: `${note.agent} · ${note.model}`, task: note.task } : {})
    })
  }
  return out
}

/** Where the branch left its base: a base that moved on must not show its own newer work as this branch's deletions. */
async function forkPoint(path: string, base: string): Promise<string> {
  const r = await git(['merge-base', base, 'HEAD'], { cwd: path })
  return r.ok && r.stdout.trim() !== '' ? r.stdout.trim() : base
}

export async function worktreeDetail(path: string, base: string): Promise<WorktreeDetail> {
  const from = await forkPoint(path, base)
  const [files, commits] = await Promise.all([readChanges(path, from, 'HEAD'), commitsSince(path, from)])
  return { files, commits }
}

/** One file's diff by the id `worktreeDetail` listed (never a path from the caller). */
export async function worktreeFileDiff(path: string, base: string, fileId: string): Promise<{ diff: string; truncated: boolean } | null> {
  const from = await forkPoint(path, base)
  const f = (await readChanges(path, from, 'HEAD'))?.find((x) => x.id === fileId)
  return f ? readFileDiff(path, from, 'HEAD', f) : null
}

/** One file's diff against the working tree: against the fork point of `baseRef` for a plan's worktree, against HEAD
 *  otherwise. Uncommitted edits, commits since the base and deleted files all come in one diff (head=null). */
export async function workingFileDiff(root: string, relPath: string, baseRef: string | null): Promise<{ diff: string; truncated: boolean } | null> {
  const from = baseRef ? await forkPoint(root, baseRef) : 'HEAD'
  const f = (await readChanges(root, from, null))?.find((x) => x.path === relPath)
  return f ? readFileDiff(root, from, null, f) : null
}
