// Pure logic of the Pull requests side bar view: the text filter, one row's view model and what its actions allow.
import type { OpenPrsResult, PrChecks, RepoPr } from '../../../../core/github/types'
import type { MessageKey } from '../../../../core/i18n'

/** Why the list is not showing PRs (the failures of `pr.listOpen`), as the view tells them apart. */
export type PrListFailure = Extract<OpenPrsResult, { ok: false }>['kind']

/** The list the view holds, tagged with the project path it was loaded for. */
export type PrLoad =
  | { state: 'loading' }
  | { state: 'ready'; path: string; prs: RepoPr[] }
  | { state: 'failed'; path: string; kind: PrListFailure; message: string }

/** The load when it was made for `path`; one made for another project (or none yet) reads as loading. */
export function loadForPath(load: PrLoad, path: string | null): PrLoad {
  return load.state === 'loading' || load.path === path ? load : { state: 'loading' }
}

/** The PRs whose number, title, author or branches contain every word of the query (case-insensitive). */
export function filterPrs(prs: readonly RepoPr[], query: string): RepoPr[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...prs]
  return prs.filter((pr) => {
    const hay = `#${pr.number} ${pr.title} ${pr.author} ${pr.head} ${pr.base}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

const CHECKS_LABEL: Record<Exclude<PrChecks, null>, MessageKey> = {
  pending: 'github.badge.checks.pending',
  failing: 'github.badge.checks.failing',
  passing: 'github.badge.checks.passing'
}

export interface PrRowView {
  title: string
  /** `author · head → base`; the author is left out when GitHub no longer knows the account. */
  meta: string
  size: { additions: number; deletions: number }
  /** The checks word; null when the PR has no checks (nothing to say). */
  checks: { key: MessageKey; tone: 'ok' | 'warn' | 'danger' } | null
  draft: boolean
  /** Milliseconds since the last update; 0 when the date does not parse. */
  ageMs: number
}

export function prRowView(pr: RepoPr, now: number): PrRowView {
  const updated = Date.parse(pr.updatedAt)
  const branches = `${pr.head} → ${pr.base}`
  return {
    title: `#${pr.number} ${pr.title}`,
    meta: pr.author ? `${pr.author} · ${branches}` : branches,
    size: { additions: pr.additions, deletions: pr.deletions },
    checks: pr.checks === null ? null : { key: CHECKS_LABEL[pr.checks], tone: pr.checks === 'passing' ? 'ok' : pr.checks === 'failing' ? 'danger' : 'warn' },
    draft: pr.isDraft,
    ageMs: Number.isNaN(updated) ? 0 : Math.max(0, now - updated)
  }
}

/** The merge methods `pr.merge` takes (core/github/prMerge.ts, which the renderer cannot import). */
export const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const
export type MergeMethod = (typeof MERGE_METHODS)[number]

/** A draft cannot be merged; nothing else is checked here — GitHub answers `not-mergeable` for the rest. */
export const canMerge = (pr: Pick<RepoPr, 'isDraft'>, busy: boolean): boolean => !pr.isDraft && !busy
