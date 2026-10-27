import { ghFailureSentence, type GhRunner } from './gh'
import { foldChecks } from './prs'
import type { OpenPrsResult, RepoPr } from './types'

/** The exact argv for the full open-PR list (cwd = the repository). */
export const PR_OPEN_LIST_ARGS = [
  'pr',
  'list',
  '--state',
  'open',
  '--limit',
  '100',
  '--json',
  'number,title,author,headRefName,baseRefName,isDraft,url,updatedAt,additions,deletions,reviewDecision,statusCheckRollup'
]

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Parses `gh pr list --state open --json` output, newest update first. Null when the output is not
 *  a JSON array — a failed fetch, never an empty list. A row without number/title/url is skipped. */
export function parseOpenPrs(stdout: string): RepoPr[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const prs: RepoPr[] = []
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.number !== 'number' || typeof r.title !== 'string' || typeof r.url !== 'string') continue
    const author = r.author !== null && typeof r.author === 'object' ? str((r.author as { login?: unknown }).login) : ''
    prs.push({
      number: r.number,
      title: r.title,
      author,
      head: str(r.headRefName),
      base: str(r.baseRefName),
      isDraft: r.isDraft === true,
      url: r.url,
      updatedAt: str(r.updatedAt),
      additions: num(r.additions),
      deletions: num(r.deletions),
      ...(typeof r.reviewDecision === 'string' && r.reviewDecision !== '' ? { reviewDecision: r.reviewDecision } : {}),
      checks: foldChecks(r.statusCheckRollup)
    })
  }
  // ISO 8601 strings in one zone sort as text
  return prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/** Runs the list and classifies a failure for the Pull requests tab. */
export async function listOpenPrs(run: GhRunner, cwd: string): Promise<OpenPrsResult> {
  const r = await run(PR_OPEN_LIST_ARGS, cwd)
  if (!r.ok) {
    const f = ghFailureSentence(r)
    const kind = f.kind === 'auth' ? 'not-authenticated' : f.kind === 'not-installed' || f.kind === 'no-remote' ? f.kind : 'error'
    return { ok: false, kind, message: f.message }
  }
  const prs = parseOpenPrs(r.stdout)
  if (prs === null) return { ok: false, kind: 'error', message: 'gh pr list answered with something that is not JSON' }
  return { ok: true, prs }
}
