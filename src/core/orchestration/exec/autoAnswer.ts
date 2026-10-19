// T21 (owner, 2026-10-18): "i want him to automatically answer the questions". The Host answers the open questions it
// safely can (Gates, worker asks, coordinator escalations), from its own state first, else with the safe default; the
// rest stay with the owner. Pure: dispatchLoop.ts answers through `questions-answer` and writes the feed line.
import type { OrchState } from '../state'
import type { Task } from '../types'
import { readAppSettingsObject } from '../../settings/settingsObject'

/** One open question as `questions-list` returns it: a Gate (with its `kind`) or an ask / escalation (`source`). */
export interface OpenQuestion {
  id: string
  runId: string
  taskId: string
  question: string
  options?: string[]
  kind?: string
  source?: 'ask' | 'escalation'
  createdAt: string
}

export interface AutoAnswer {
  id: string
  answer: string
  why: 'Host state' | 'asked-for default' | 'safe default'
}

/** A worker's ask is its coordinator's to answer first: Astera steps in once it has waited this long. */
export const ASK_GRACE_MS = 30_000

/** On unless app-settings.json says `autoAnswer: false`, read the way the stall watchdog's setting is. */
export const autoAnswerOnOf = (value: unknown): boolean => value !== false

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is the default. */
export async function readAutoAnswerOn(filePath: string): Promise<boolean> {
  return autoAnswerOnOf((await readAppSettingsObject(filePath).catch(() => null))?.autoAnswer)
}

// What only the owner decides: deleting work, the default branch, money, credentials, permissions, "ask me"
const OWNER_ONLY: RegExp[] = [
  /\b(delet|remov|drop|discard|destroy|wip(e|ing)|purg|overwrit|revert|abandon)\w*|rm -rf|reset --hard|force[- ]?push/i,
  /\b(push|merg)\w*\b[^\n]{0,60}\b(main|master|trunk|default branch|production|prod)\b/i,
  /\b(main|master|trunk|default branch)\b[^\n]{0,30}\b(push|merg)\w*/i,
  /\$\s?\d|\b(money|pay|paid|payment|purchas\w*|billing|invoice|subscri\w*|credit card|spend\w*|buy|pric\w*|usd|eur)\b/i,
  /\b(credential|password|passphrase|secret|token|api[- ]?key|ssh key|private key|log ?in|sign ?in|oauth|2fa|keychain)s?\b/i,
  /\b(permission|sudo|root access|allow|grant|authori[sz]e|chmod)\w*/i,
  /\bask me\b/i
]
const ownerOnly = (text: string): boolean => OWNER_ONLY.some((re) => re.test(text))

// The safe defaults, in the owner's order; then the two words a state fact picks between
const SAFE: RegExp[] = [/^(hold|keep holding)\b/i, /^wait\b/i, /^retry(-once)?\b/i, /^skip-check$/i]
const GO = /^(go|go ahead|proceed|continue|yes|start|resume|release|unhold)\b/i
const HOLD = /^(hold|wait|no|later|defer)\b/i

/** The answers a question offers: its options, else the words of a "go or hold" / "say X" in its text. */
function choicesOf(q: OpenQuestion): string[] {
  if (q.options && q.options.length > 0) return q.options
  const offered = new Set<string>()
  for (const m of q.question.matchAll(/\b([a-z][\w-]*)\s*(?:\/|\bor\b)\s*([a-z][\w-]*)\b/gi)) offered.add(m[1]).add(m[2])
  for (const m of q.question.matchAll(/\b(?:say|answer|reply)\s+["'`]?([a-z][\w-]*)/gi)) offered.add(m[1])
  return [...offered]
}

/** The option the asker itself recommends: one marked "(recommended)", or named just after recommend/suggest/default. */
function recommendedOf(q: OpenQuestion): string | undefined {
  const marked = q.options?.find((o) => /\brecommended\b/i.test(o))
  if (marked) return marked
  return q.options?.find((o) => {
    const word = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b(recommend\\w*|suggest\\w*|default|prefer\\w*)\\b[^.\\n]{0,40}?(?<![\\w-])${word}(?![\\w-])`, 'i').test(q.question)
  })
}

/** "W9-A" of "W9-A · Coordinator answers"; null for a title that does not start with such a label. */
const labelOf = (t: Task): string | null => /^([A-Z]+\d+(?:-[A-Z0-9]+)?)\b/.exec(t.title)?.[1] ?? null
const names = (text: string, word: string): boolean =>
  new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text)

/** The Tasks a question names, by id, label, or wave ("W9" names every W9-*); never the asking Task itself. */
function namedTasks(s: OrchState, q: OpenQuestion): Task[] {
  return s.tasks.filter((t) => {
    if (t.id === q.taskId) return false
    if (names(q.question, t.id)) return true
    const label = labelOf(t)
    return label !== null && (names(q.question, label) || (label.includes('-') && names(q.question, label.split('-')[0])))
  })
}

/** Facts first: a question about whether named Tasks merged, finished or wait on something, from Host state. */
function fromState(s: OrchState, q: OpenQuestion, choices: string[]): AutoAnswer | null {
  if (!/\b(merg\w*|done|finish\w*|complet\w*|land\w*|wait\w*|until|blocked|ready|status|wave)\b/i.test(q.question)) return null
  const tasks = namedTasks(s, q)
  if (tasks.length === 0) return null
  const aboutMerge = /\bmerg/i.test(q.question)
  const settled = (t: Task): boolean => (aboutMerge ? t.mergedIntoPlanAt !== undefined : t.status === 'completed')
  const allSettled = tasks.every(settled)
  if (choices.length > 0) {
    const pick = choices.find((c) => (allSettled ? GO : HOLD).test(c.trim()))
    return pick ? { id: q.id, answer: pick, why: 'Host state' } : null
  }
  const byId = new Map(s.tasks.map((t) => [t.id, t]))
  const lines = tasks.map((t) => {
    const name = `${labelOf(t) ?? t.title} (${t.id})`
    const waits = t.deps.map((d) => byId.get(d)).filter((d): d is Task => d !== undefined && d.status !== 'completed')
    return (
      `${name} is ${t.status}` +
      (t.mergedIntoPlanAt ? `, merged into the plan branch at ${t.mergedIntoPlanAt}` : t.status === 'completed' ? ', not merged into the plan branch yet' : '') +
      (waits.length > 0 ? `; it waits on ${waits.map((d) => `${labelOf(d) ?? d.title} (${d.status})`).join(', ')}` : '')
    )
  })
  return { id: q.id, answer: `Host state: ${lines.join('. ')}. ${allSettled ? 'Go ahead.' : 'Hold until it is.'}`, why: 'Host state' }
}

/**
 * The answer Astera gives to one open question, or null when it stays with the owner. `retried` is true when an
 * earlier Gate on the same Task was already answered with a retry: "retry once" means once, so no retry again.
 */
export function autoAnswerOf(s: OrchState, q: OpenQuestion, retried = false): AutoAnswer | null {
  const task = s.tasks.find((t) => t.id === q.taskId)
  // A Gate the Host wrote itself (`kind`) carries check output in its text; only its fixed options are judged
  if (!q.kind && ownerOnly(q.question)) return null
  if (task && /\bask me\b/i.test(`${task.prompt ?? ''}\n${task.spec}`)) return null
  const choices = choicesOf(q)
  return fromState(s, q, choices) ?? safeDefault(q, choices, retried)
}

function safeDefault(q: OpenQuestion, choices: string[], retried: boolean): AutoAnswer | null {
  const usable = choices.filter((c) => !(retried && /^retry/i.test(c.trim())))
  const recommended = recommendedOf(q)
  // The asker's own pick is judged as well: "delete-branch (recommended)" is still the owner's
  if (recommended && usable.includes(recommended) && !ownerOnly(recommended)) return { id: q.id, answer: recommended, why: 'asked-for default' }
  for (const re of SAFE) {
    const pick = usable.find((c) => re.test(c.trim()))
    if (pick) return { id: q.id, answer: pick, why: 'safe default' }
  }
  return null
}

/** The open questions due an answer now, each with its answer. Asks wait out `ASK_GRACE_MS` for their coordinator. */
export function autoAnswersDue(s: OrchState, open: OpenQuestion[], nowMs: number): AutoAnswer[] {
  return open.flatMap((q) => {
    if (q.source === 'ask' && nowMs - Date.parse(q.createdAt) < ASK_GRACE_MS) return []
    const retried = s.gates.some((g) => g.taskId === q.taskId && g.id !== q.id && g.status === 'resolved' && /^retry/i.test(g.resolution ?? ''))
    return autoAnswerOf(s, q, retried) ?? []
  })
}

/** The feed line: "Auto-answered: hold — W9-B Coordinator answers (safe default)". */
export function autoAnswerLine(s: OrchState, q: Pick<OpenQuestion, 'taskId'>, a: AutoAnswer): string {
  const task = s.tasks.find((t) => t.id === q.taskId)
  const answer = a.answer.length > 160 ? `${a.answer.slice(0, 157)}...` : a.answer
  return `Auto-answered: ${answer} — ${task?.title ?? q.taskId} (${a.why})`
}
