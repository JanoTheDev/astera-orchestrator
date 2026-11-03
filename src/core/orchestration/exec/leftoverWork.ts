// A worker that reports its Task done must have committed its work: git merges commits only, so a change left staged
// or unsaved in the worktree never reaches the plan branch, the review reads files the delivery will not carry, and the
// push delivery later stops on "these worktrees hold work that was not merged" (owner report 2026-11-02,
// run_d7918893935ddbd7: the worker staged its change, never committed it, its review approved, the Task completed,
// and the delivery undid every merge until a person committed it by hand). The commit obligation in the worker's spec
// asks for it (coordinator.ts commitObligation); this is where Astera makes sure of it, before the report is accepted.
//
// This module must stay importable by the Host: no electron, nothing from src/main.

import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../../worktrees/git'
import { mergeIdentityArgs } from './integrateGit'

/** How a worker's worktree was found when its report came in. `clean`: nothing left out; `committed`: Astera
 *  committed what was left (`files` of them) as the worker's work; `unknown`: git could not tell (the report goes on,
 *  and the delivery's own check still guards the merge); `failed`: there is uncommitted work and it could not be
 *  committed (a hook, a conflict left in the index): the worker has to commit it itself. */
export type LeftoverWork =
  | { kind: 'clean' }
  | { kind: 'committed'; sha: string; files: number }
  | { kind: 'unknown'; reason: string }
  | { kind: 'failed'; files: number; reason: string }

/** An untracked node_modules (the worktree's link to the project's) is no work of the worker's: the same rule as the
 *  merge's count (integrateGit.ts integrateWorktrees). */
const NODE_MODULES_LINK = /^\?\? "?node_modules\/?"?$/

/** The lines of `git status --porcelain` that are the worker's work. */
export const leftoverLines = (porcelain: string): string[] =>
  porcelain.split('\n').filter((l) => l.trim() !== '' && !NODE_MODULES_LINK.test(l.trimEnd()))

/**
 * Commits whatever the worker left uncommitted in `worktree` (staged, modified, or new and not ignored), as one commit
 * with `message`, so it travels with the Task's branch. Nothing is discarded, reset or stashed: the commit holds exactly
 * what the folder holds. An unmerged path (a conflict the worker left) is never committed: that is `failed`.
 * `--no-verify`: the work is the worker's and its checks run next (validation, review); a pre-commit hook that refuses
 * would only leave the work where the merge cannot see it. Never throws.
 */
export async function commitLeftoverWork(worktree: string, message: string, run: typeof realGit = realGit): Promise<LeftoverWork> {
  try {
    const status = await run(['status', '--porcelain'], { cwd: worktree, trim: false })
    if (!status.ok) return { kind: 'unknown', reason: (status.stderr || status.stdout || 'git status failed').trim() }
    const lines = leftoverLines(status.stdout)
    if (lines.length === 0) return { kind: 'clean' }
    // An unmerged entry (UU, AA, DU …) is a conflict left half resolved: committing it would commit the markers
    if (lines.some((l) => /^(DD|AU|UD|UA|DU|AA|UU) /.test(l)))
      return { kind: 'failed', files: lines.length, reason: 'the worktree has unresolved merge conflicts' }
    const add = await run(['add', '-A', '--', '.', ':(exclude)node_modules'], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
    if (!add.ok) return { kind: 'failed', files: lines.length, reason: `git add failed: ${(add.stderr || add.stdout).trim()}` }
    const staged = await run(['diff', '--cached', '--quiet'], { cwd: worktree })
    // Exit 0: nothing staged after all (only ignored or excluded paths changed)
    if (staged.ok) return { kind: 'clean' }
    const ident = await mergeIdentityArgs(worktree, run)
    const commit = await run([...ident, 'commit', '--no-verify', '-m', message], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
    if (!commit.ok) return { kind: 'failed', files: lines.length, reason: `git commit failed: ${(commit.stderr || commit.stdout).trim()}` }
    const sha = await run(['rev-parse', 'HEAD'], { cwd: worktree })
    return { kind: 'committed', sha: sha.ok ? sha.stdout : '', files: lines.length }
  } catch (e) {
    return { kind: 'unknown', reason: String(e) }
  }
}
