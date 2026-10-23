import { classifyGhFailure, defaultGhRunner, type GhRunner } from './gh'
import type { GhFailureKind } from './types'

export type PrMergeMethod = 'merge' | 'squash' | 'rebase'
export const PR_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const satisfies readonly PrMergeMethod[]

export interface PrMergeRequest {
  cwd: string
  /** A PR number, or the branch gh resolves to its open PR. */
  number?: number
  branch?: string
  method: PrMergeMethod
  /** `--delete-branch`: the remote branch (and the local one, when gh can) goes with the merge. */
  deleteBranch?: boolean
}

/** gh's kinds, plus the failures only a merge has: a PR that cannot be merged as it stands (conflicts, a failing or
 *  pending required check, a missing review, a protected branch) and one that is already merged or closed. */
export type PrMergeFailureKind = GhFailureKind | 'not-mergeable' | 'already-merged' | 'not-installed'

export type PrMergeResult = { ok: true } | { ok: false; kind: PrMergeFailureKind; detail: string }

export async function mergePullRequest(req: PrMergeRequest, runGh: GhRunner = defaultGhRunner): Promise<PrMergeResult> {
  const target = req.number !== undefined ? String(req.number) : req.branch
  if (target === undefined || target === '' || target.startsWith('-')) return { ok: false, kind: 'other', detail: 'a pull request number or branch is required' }
  const args = ['pr', 'merge', target, `--${req.method}`]
  if (req.deleteBranch) args.push('--delete-branch')
  const r = await runGh(args, req.cwd)
  if (r.ok) return { ok: true }
  const s = r.stderr.toLowerCase()
  const kind: PrMergeFailureKind =
    r.spawnError === 'ENOENT'
      ? 'not-installed'
      : s.includes('already merged') || s.includes('is closed')
        ? 'already-merged'
        : s.includes('not mergeable') || s.includes('merge conflict') || s.includes('required status check') || s.includes('review is required') || s.includes('base branch policy')
          ? 'not-mergeable'
          : classifyGhFailure(r.stderr, r.spawnError)
  return { ok: false, kind, detail: r.stderr.trim() || r.spawnError || 'gh pr merge failed' }
}
