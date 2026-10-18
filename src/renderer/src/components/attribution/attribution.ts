// W8-B: what the attribution views read, as pure functions over W8-A's command replies (`attribution-blame`,
// `attribution-stats`, PLAN.md "Wave 8 contracts"), so the views stay thin and the rules are tested here.
//
// shortcut: the reply shapes are read loosely (W8-A runs in parallel, and only the note and the git-ai stats names are
// in the contract). A blame row may carry its own `kind`, or the commit's note plus the line's number in that commit
// (`origLine`), which `lineKindOf` resolves. Tighten to W8-A's types once it merges.

/** The note's `lines`: per path, the AI line ranges in the note's commit, 1-based and inclusive. */
export type NoteLines = { [path: string]: [number, number][] }

/** The Wave 8 note fields the views read. */
export interface NoteView {
  agent?: string
  model?: string
  account?: string
  job?: string
  task?: string
  session?: string
  role?: string
  human?: boolean
  lines?: NoteLines
}

export type LineKind = 'ai' | 'human' | 'unknown'

/** One line of a file, as the gutter shows it. */
export interface BlameLine extends NoteView {
  line: number
  kind: LineKind
  sha?: string
}

/** What a note says about one line of a file in the note's commit: `ai` when the note has no `lines` (the whole
 *  commit is AI) or the line is in its ranges; `human` when the note says so or the line is outside them; `unknown`
 *  with no note (a commit Astera did not stamp, or a line `git mv` carried, PLAN.md parity table). */
export function lineKindOf(note: NoteView | null | undefined, file: string, line: number): LineKind {
  if (!note) return 'unknown'
  if (note.human === true) return 'human'
  if (note.lines === undefined) return 'ai'
  return (note.lines[file] ?? []).some(([a, b]) => a <= line && line <= b) ? 'ai' : 'human'
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** The rows of an `attribution-blame` reply (an array, or `{ lines: [...] }`), one per line. A row it cannot read is
 *  skipped, so the line shows no marker rather than a wrong one. */
export function blameLinesOf(body: unknown, file: string): BlameLine[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { lines?: unknown })?.lines) ? (body as { lines: unknown[] }).lines : []
  const out: BlameLine[] = []
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.line !== 'number') continue
    const note = (r.note && typeof r.note === 'object' ? r.note : null) as (NoteView & Record<string, unknown>) | null
    const src = { ...(note ?? {}), ...r } as Record<string, unknown>
    const kind: LineKind =
      r.kind === 'ai' || r.kind === 'human' || r.kind === 'unknown'
        ? r.kind
        : lineKindOf(note, str(r.path) ?? file, typeof r.origLine === 'number' ? r.origLine : r.line)
    out.push({
      line: r.line,
      kind,
      sha: str(src.sha),
      agent: str(src.agent),
      model: str(src.model),
      account: str(src.account),
      job: str(src.job),
      task: str(src.task),
      session: str(src.session),
      role: str(src.role)
    })
  }
  return out
}

/** The gutter chip of a line: short text, its full meaning for a screen reader and the tooltip, and the class that
 *  colours it. The text alone tells the three apart, so colour is never the only signal. */
export function markerOf(l: BlameLine): { text: string; label: string; className: string } {
  if (l.kind === 'ai') {
    const who = [l.agent, l.model].filter(Boolean).join('/') || 'agent'
    return {
      text: 'AI',
      label: `Line ${l.line}: AI, ${who}${l.task ? `, Task ${l.task}` : ''}. Open for the Task and session.`,
      className: 'attr-chip attr-ai'
    }
  }
  if (l.kind === 'human')
    return { text: 'H', label: `Line ${l.line}: human. Open for the commit.`, className: 'attr-chip attr-human' }
  return { text: '?', label: `Line ${l.line}: unknown author. Open for the commit.`, className: 'attr-chip attr-unknown' }
}

/** The git-ai stats fields (PLAN.md: the Stats JSON names match git-ai's). */
export interface AttributionStats {
  human_additions: number
  ai_additions: number
  ai_accepted?: number
  git_diff_added_lines?: number
  git_diff_deleted_lines?: number
  tool_model_breakdown: { [toolModel: string]: { ai_additions: number; ai_accepted?: number } }
}

/** An `attribution-stats --json` reply, or null when it is not one. */
export function statsOf(body: unknown): AttributionStats | null {
  const b = body as Partial<AttributionStats> | null
  if (!b || typeof b !== 'object' || typeof b.ai_additions !== 'number' || typeof b.human_additions !== 'number') return null
  const breakdown: AttributionStats['tool_model_breakdown'] = {}
  for (const [k, v] of Object.entries(b.tool_model_breakdown ?? {}))
    if (v && typeof v.ai_additions === 'number') breakdown[k] = { ai_additions: v.ai_additions, ai_accepted: v.ai_accepted }
  return { ...b, ai_additions: b.ai_additions, human_additions: b.human_additions, tool_model_breakdown: breakdown }
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
