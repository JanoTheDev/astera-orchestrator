/** GitHub PR shapes shared between main and the renderer. Node-free on purpose — see the
 *  design doc (docs/superpowers/specs/2026-09-01-github-pr-badges-design.md) §3.2. */

export type PrState = 'open' | 'merged' | 'closed'

/** statusCheckRollup folded to one value; null = the PR has no checks at all. */
export type PrChecks = 'pending' | 'passing' | 'failing' | null

export interface PrInfo {
  number: number
  title: string
  state: PrState
  /** Only meaningful while state === 'open' — GitHub clears the flag on merge/close. */
  isDraft: boolean
  url: string
  checks: PrChecks
}

/** One open PR in the full list (`gh pr list --state open`). */
export interface RepoPr {
  number: number
  title: string
  /** Author login; '' when GitHub no longer has the account. */
  author: string
  head: string
  base: string
  isDraft: boolean
  url: string
  updatedAt: string // ISO 8601
  additions: number
  deletions: number
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED; absent when the repo requires no review. */
  reviewDecision?: string
  checks: PrChecks
}

export type OpenPrsResult =
  | { ok: true; prs: RepoPr[] }
  | { ok: false; kind: 'not-installed' | 'not-authenticated' | 'no-remote' | 'error'; message: string }

/** One repository's PRs keyed by head branch name. */
export interface RepoPrSnapshot {
  byBranch: Record<string, PrInfo>
  fetchedAt: string // ISO 8601
  /** True while the rate-limit breaker holds — last known data, not current. */
  stale: boolean
}

export type GhStatusKind = 'connected' | 'not-installed' | 'not-authenticated' | 'error'

export interface GhProbe {
  kind: GhStatusKind
  /** Login parsed from `gh auth status` output when connected — costs no API quota. */
  account?: string
}

export type GhFailureKind =
  | 'rate-limit'
  | 'auth'
  | 'network'
  | 'not-found'
  /** `gh pr list` in a repo with no configured remote — "no git remotes found" — cannot
   *  succeed until the repo is reconfigured, so the coordinator memoizes it per repo path. */
  | 'no-remote'
  /** stdout overflowed maxBuffer and was cut off; see gh.ts's MAX_BUFFER_BYTES comment. */
  | 'truncated'
  | 'other'
