// The custom_id of every button, select menu and modal the plan workspace posts: `astera:<action>:<id>[:<n>]`.
// It comes back from Discord in an interaction, so parsing is strict: anything that is not exactly one of
// these shapes is ignored, never guessed at. A modal reuses the custom_id of the button that opened it; the
// interaction type tells the two apart.

/** Discord's cap on a custom_id. */
export const CUSTOM_ID_MAX = 100

export type ComponentId =
  /** Approve & execute a plan (id: jobId). */
  | { action: 'approve'; id: string }
  /** Answer a Gate with one of its options (id: gateId; n: the option index, or on a select menu the menu's
   *  number — the option index then comes in the select's value). */
  | { action: 'gate'; id: string; n: number }
  /** Answer a Gate in your own words: opens a modal (id: gateId). */
  | { action: 'gate-other'; id: string }
  /** Talk to a plan's planner: opens a modal (id: jobId). */
  | { action: 'feedback'; id: string }

const ID = /^[A-Za-z0-9_-]+$/
const INDEX = /^(0|[1-9]\d{0,3})$/

export function customId(c: ComponentId): string {
  if (!ID.test(c.id)) throw new Error('custom_id: the id must be [A-Za-z0-9_-]')
  const out = c.action === 'gate' ? `astera:gate:${c.id}:${c.n}` : `astera:${c.action}:${c.id}`
  if (out.length > CUSTOM_ID_MAX) throw new Error('custom_id: over 100 characters')
  return out
}

export function parseCustomId(raw: unknown): ComponentId | null {
  if (typeof raw !== 'string' || raw.length > CUSTOM_ID_MAX) return null
  const parts = raw.split(':')
  if (parts[0] !== 'astera' || !ID.test(parts[2] ?? '')) return null
  const [, action, id, n] = parts
  if (action === 'gate') return parts.length === 4 && INDEX.test(n) ? { action, id, n: Number(n) } : null
  if (parts.length !== 3) return null
  if (action === 'approve' || action === 'gate-other' || action === 'feedback') return { action, id }
  return null
}
