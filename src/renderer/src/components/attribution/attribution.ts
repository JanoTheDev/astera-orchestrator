// W8-B: what the attribution views read, as pure functions over W8-A's command replies (`attribution-blame`,
// `attribution-stats`, PLAN.md "Wave 8 contracts"), so the views stay thin and the rules are tested here.

import type { Translate } from '../checkText'

/** An `attribution-stats` reply (core/attribution/stats.ts AttributionStats; that file is not in the renderer's build). */
export interface AttributionStats {
  human_additions: number
  mixed_additions: number
  ai_additions: number
  ai_accepted: number
  unknown_additions: number
  git_diff_added_lines: number
  git_diff_deleted_lines: number
  tool_model_breakdown: { [toolModel: string]: { ai_additions: number; ai_accepted: number } }
}

export type LineKind = 'ai' | 'human' | 'unknown'

/** One line of a file, as the gutter shows it: W8-A's blame row, its note fields the details read. */
export interface BlameLine {
  line: number
  kind: LineKind
  sha?: string
  agent?: string
  model?: string
  account?: string
  job?: string
  task?: string
  session?: string
  role?: string
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** The rows of an `attribution-blame` reply (core/attribution/cli.ts BlameRow[]: line, sha, kind, content and the
 *  note's agent, model, account, job, task, session, role), one per line. A mixed line (AI, then
 *  edited by a person) shows as AI, its agent named; a row it cannot read is skipped, so the line shows no marker. */
export function blameLinesOf(body: unknown): BlameLine[] {
  if (!Array.isArray(body)) return []
  const out: BlameLine[] = []
  for (const r of body as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.line !== 'number') continue
    out.push({
      line: r.line,
      kind: r.kind === 'mixed' ? 'ai' : r.kind === 'ai' || r.kind === 'human' ? r.kind : 'unknown',
      sha: str(r.sha),
      agent: str(r.agent),
      model: str(r.model),
      account: str(r.account),
      job: str(r.job),
      task: str(r.task),
      session: str(r.session),
      role: str(r.role)
    })
  }
  return out
}

/** The gutter chip of a line: short text, its full meaning for a screen reader and the tooltip, and the class that
 *  colours it. The text alone tells the three apart, so colour is never the only signal. */
export function markerOf(l: BlameLine, t: Translate): { text: string; label: string; className: string } {
  if (l.kind === 'ai') {
    const who = [l.agent, l.model].filter(Boolean).join('/') || t('attribution.agent')
    return {
      text: 'AI',
      label: l.task ? t('attribution.label.aiTask', { line: l.line, who, task: l.task }) : t('attribution.label.ai', { line: l.line, who }),
      className: 'attr-chip attr-ai'
    }
  }
  if (l.kind === 'human')
    return { text: 'H', label: t('attribution.label.human', { line: l.line }), className: 'attr-chip attr-human' }
  return { text: '?', label: t('attribution.label.unknown', { line: l.line }), className: 'attr-chip attr-unknown' }
}

/** An `attribution-stats --json` reply, or null when it is not one. */
export function statsOf(body: unknown): AttributionStats | null {
  const b = body as Partial<AttributionStats> | null
  if (!b || typeof b !== 'object' || typeof b.ai_additions !== 'number' || typeof b.human_additions !== 'number') return null
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const breakdown: AttributionStats['tool_model_breakdown'] = {}
  for (const [k, v] of Object.entries(b.tool_model_breakdown ?? {}))
    if (v && typeof v.ai_additions === 'number') breakdown[k] = { ai_additions: v.ai_additions, ai_accepted: n(v.ai_accepted) }
  return {
    human_additions: b.human_additions,
    mixed_additions: n(b.mixed_additions),
    ai_additions: b.ai_additions,
    ai_accepted: n(b.ai_accepted),
    unknown_additions: n(b.unknown_additions),
    git_diff_added_lines: n(b.git_diff_added_lines),
    git_diff_deleted_lines: n(b.git_diff_deleted_lines),
    tool_model_breakdown: breakdown
  }
}

/** Whole-percent share of AI lines among added lines; null with none added. */
export function percentAi(s: Pick<AttributionStats, 'ai_additions' | 'human_additions'>): number | null {
  const total = s.ai_additions + s.human_additions
  return total === 0 ? null : Math.round((s.ai_additions * 100) / total)
}

/** The breakdown, largest first, each with its whole-percent share of all added lines. `claude::opus` reads
 *  `claude / opus`. */
export function breakdownOf(s: AttributionStats): { name: string; lines: number; percent: number }[] {
  const total = s.ai_additions + s.human_additions
  return Object.entries(s.tool_model_breakdown)
    .map(([k, v]) => ({
      name: k.split('::').join(' / '),
      lines: v.ai_additions,
      percent: total === 0 ? 0 : Math.round((v.ai_additions * 100) / total)
    }))
    .sort((a, b) => b.lines - a.lines)
}

/** The commit of the project's latest push delivery (`JobRun.delivery.sha`, W6-H), from a `runs-list` reply; undefined
 *  with none. A PR delivery has no local commit, so it does not count here. */
export function lastDeliveryOf(runs: unknown): string | undefined {
  if (!Array.isArray(runs)) return undefined
  let best: { at: string; sha: string } | undefined
  for (const r of runs as { delivery?: { at?: unknown; sha?: unknown } }[]) {
    const at = r?.delivery?.at
    const sha = r?.delivery?.sha
    if (typeof at === 'string' && typeof sha === 'string' && (!best || at > best.at)) best = { at, sha }
  }
  return best?.sha
}
