// W3-B command layer (SPEC §8): what a typed or spoken command asks for, as data.
//
// An intent names things the way a person says them (`target: "Gameful Trading"`, `session: "worker three"`); the
// resolver (resolve.ts) turns those names into exact ids or a question. Nothing here runs anything. Pure, no node:
// the renderer's command bar and its tests both import it.

/** Every intent but `reply` may name a target: a plan, a project, or "project plan", as said. Absent: the open one. */
export type Intent =
  | { kind: 'switch'; target?: string }
  | { kind: 'show-sessions'; target?: string }
  | { kind: 'plan'; objective: string; target?: string }
  | { kind: 'approve'; target?: string }
  | { kind: 'pause'; target?: string }
  | { kind: 'resume'; target?: string }
  | { kind: 'stop-launching'; target?: string }
  /** W5-C: stop a plan for real, closing its workers and coordinator (runs-stop / run-pause). `pause` holds instead. */
  | { kind: 'stop'; target?: string }
  | { kind: 'send'; session: string; text: string; target?: string }
  | { kind: 'summarize'; minutes?: number; target?: string }
  | { kind: 'waiting'; target?: string }
  | { kind: 'archive'; target?: string }
  | { kind: 'delete'; target?: string }
  | { kind: 'merge'; target?: string }
  /** The coordinator's own answer to a question no other intent covers. */
  | { kind: 'reply'; text: string }

export type IntentKind = Intent['kind']

/** A free-text parse (parseRun.ts): the intent, and the coordinator model it ran on. */
export type Parsed = { ok: true; intent: Intent; model?: string } | { ok: false; reason: string }

export const INTENT_KINDS = [
  'switch',
  'show-sessions',
  'plan',
  'approve',
  'pause',
  'resume',
  'stop-launching',
  'stop',
  'send',
  'summarize',
  'waiting',
  'archive',
  'delete',
  'merge',
  'reply'
] as const satisfies readonly IntentKind[]

/** Longest name, objective or text accepted from a parse. A model's answer is not trusted to be short. */
const MAX_TEXT = 4000
const MAX_NAME = 200
/** A day: "summarize the last N minutes" past that is a typo or a model's invention. */
const MAX_MINUTES = 24 * 60

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' || t.length > max ? undefined : t
}

/** Narrows a parse (the coordinator model's JSON, a trust boundary) to an Intent, or null when it is not one. Unknown
 *  keys are dropped; a required field that is missing or too long makes the whole value null. */
export function readIntent(v: unknown): Intent | null {
  if (!isObject(v) || typeof v.kind !== 'string' || !(INTENT_KINDS as readonly string[]).includes(v.kind)) return null
  const kind = v.kind as IntentKind
  const target = text(v.target, MAX_NAME)
  const t = target === undefined ? {} : { target }
  switch (kind) {
    case 'reply': {
      const body = text(v.text, MAX_TEXT)
      return body === undefined ? null : { kind, text: body }
    }
    case 'plan': {
      const objective = text(v.objective, MAX_TEXT)
      return objective === undefined ? null : { kind, objective, ...t }
    }
    case 'send': {
      const session = text(v.session, MAX_NAME)
      const body = text(v.text, MAX_TEXT)
      return session === undefined || body === undefined ? null : { kind, session, text: body, ...t }
    }
    case 'summarize': {
      const m = v.minutes
      if (m === undefined || m === null) return { kind, ...t }
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > MAX_MINUTES) return null
      return { kind, minutes: m, ...t }
    }
    default:
      return { kind, ...t }
  }
}
