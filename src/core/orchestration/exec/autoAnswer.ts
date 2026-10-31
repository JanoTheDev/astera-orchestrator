// T21 (owner, 2026-10-18): "i want him to automatically answer the questions". The Host answers the open questions it
// safely can (Gates, worker asks, coordinator escalations), from its own state first, else with the safe default; the
// rest stay with the owner. Pure: dispatchLoop.ts answers through `questions-answer` and writes the feed line.
import type { OrchState } from '../state'
import { projectOfJob } from '../projects'
import type { Decision, Task } from '../types'
import { isFailedWait } from '../replan'
import { isDroppedGate, isDuplicateGate, isStoppedDepGate } from '../overlap'
import { isLeaseWaitGate } from '../schedule'
import { readAppSettingsObject } from '../../settings/settingsObject'
import { SCOPE_WHY, scopeAnswerOf, type ScopeContext } from './scopeDecider'

/** One open question as `questions-list` returns it: a Gate (with its `kind`) or an ask / escalation (`source`). */
export interface OpenQuestion {
  id: string
  runId: string
  taskId: string
  question: string
  options?: string[]
  kind?: string
  /** `approval`: a worker asks the owner to run an owner-only command for it (command.ts answerApproval) */
  source?: 'ask' | 'escalation' | 'approval'
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

// Permissions and grants: the one owner-only case a standing grant (`grantOf`) can cover
const PERMISSION = /\b(permission|sudo|root access|allow|grant|authori[sz]e|chmod)\w*/i
// What only the owner decides: deleting work, the default branch, money, credentials, permissions, "ask me"
const OWNER_ONLY: RegExp[] = [
  /\b(delet|remov|drop|discard|destroy|wip(e|ing)|purg|overwrit|revert|abandon)\w*|rm -rf|reset --hard|force[- ]?push/i,
  /\b(push|merg)\w*\b[^\n]{0,60}\b(main|master|trunk|default branch|production|prod)\b/i,
  /\b(main|master|trunk|default branch)\b[^\n]{0,30}\b(push|merg)\w*/i,
  /\$\s?\d|\b(money|pay|paid|payment|purchas\w*|billing|invoice|subscri\w*|credit card|spend\w*|buy|pric\w*|usd|eur)\b/i,
  /\b(credential|password|passphrase|secret|token|api[- ]?key|ssh key|private key|log ?in|sign ?in|oauth|2fa|keychain)s?\b/i,
  PERMISSION,
  /\bask me\b/i
]
const ownerOnly = (text: string): boolean => OWNER_ONLY.some((re) => re.test(text))
/** A question the Host asked itself with fixed options (a stopped dep, a duplicate, a lease wait, a dropped Task): its
 *  text quotes Task titles ("Remove the old shell") and options ("drop this dependency") that read as owner-only words,
 *  so only its options are judged, as for a Gate with a `kind`. */
const hostAsked = (q: OpenQuestion): boolean =>
  !!q.kind || isStoppedDepGate(q) || isDuplicateGate(q) || isLeaseWaitGate(q) || isDroppedGate(q)

// The safe defaults, in the owner's order; then the two words a state fact picks between
const SAFE: RegExp[] = [/^(hold|keep holding)\b/i, /^wait\b/i, /^(keep waiting|let it wait)\b/i, /^keep both\b/i, /^retry(-once)?\b/i, /^skip-check$/i]
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
  if (!hostAsked(q) && ownerOnly(q.question)) return null
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

/** T36: the owner's question over a failed Task that holds back its plan (replan.ts `failedWaitQuestion`): never
 *  answered by Astera, nor handed to a hands-off coordinator. Nothing else can move that plan. T4: nor a worker's
 *  request to run an owner-only command: approving it is the owner's call, and so is refusing it. */
const ownersOnly = (q: OpenQuestion): boolean =>
  q.source === 'approval' || (q.source === 'escalation' && isFailedWait({ type: 'escalation', options: q.options }))

/** Whether an earlier Gate on the question's Task was already answered with a retry. */
const retriedOf = (s: OrchState, q: OpenQuestion): boolean =>
  s.gates.some((g) => g.taskId === q.taskId && g.id !== q.id && g.status === 'resolved' && /^retry/i.test(g.resolution ?? ''))

/** The open questions due an answer now, each with its answer. Asks wait out `ASK_GRACE_MS` for their coordinator. */
export function autoAnswersDue(s: OrchState, open: OpenQuestion[], nowMs: number): AutoAnswer[] {
  return open.flatMap((q) => {
    if (ownersOnly(q)) return []
    if (q.source === 'ask' && nowMs - Date.parse(q.createdAt) < ASK_GRACE_MS) return []
    return autoAnswerOf(s, q, retriedOf(s, q)) ?? []
  })
}

/** #117: what the Host does with one open question of a hands-off plan: answer it and record the decision, or hand it
 *  to the plan's coordinator, which decides in the owner's place (`astera questions answer`). Never the owner. */
export type HandsOffStep =
  /** `hold`: a refused owner-only decision a Task needs. That Task is held for the owner (blocked, running.ts
   *  `heldForOwner`) with `reason` as its result, so the rest of the plan goes on without it. */
  | { kind: 'answer'; answer: AutoAnswer; decision: Omit<Decision, 'at'>; hold?: { taskId: string; reason: string } }
  /** A refused escalation: its Task is held the same way, and the escalation is left open as the owner's question, so
   *  the owner answering it moves the Task on (state.ts `releaseHeld`). Not answered: a refusal is not the owner's call. */
  | { kind: 'hold'; id: string; decision: Omit<Decision, 'at'>; hold: { taskId: string; reason: string } }
  | { kind: 'coordinator'; question: OpenQuestion }

// The answers that say no to a guardrail case, in this order; else the refusal is written out (REFUSED_ANSWER)
const REFUSAL: RegExp[] = [/^(hold|keep holding)\b/i, /^wait\b/i, /^(no|don't|do not)\b/i, /^skip\b/i, /^mark-failed$/i]
export const REFUSED_ANSWER =
  "Refused: this plan runs hands-off, and this is the owner's call (force-push, pushing or merging to the default " +
  'branch, deleting data outside the plan worktrees, money or credentials). Do not do it; carry on with the rest of the plan.'

/** Whether a hands-off plan refuses this question: a guardrail case only the owner decides (OWNER_ONLY). A Gate the
 *  Host wrote itself (`kind`) never is: its text is check output. The one place that decides a refusal, so a standing
 *  grant can be asked here too. */
export const refusedHandsOff = (q: OpenQuestion): boolean => !hostAsked(q) && ownerOnly(q.question)

/** T5: the words a standing grant (`Project.grants`) covers in a question's text, besides the kind itself. */
const GRANT_WORDS: Record<string, RegExp> = { migrations: /migrat/i, 'protected-paths': /protected/i }

/** T5: the standing grant of `grants` that covers this text: its GRANT_WORDS, or the kind word itself (a `-` also
 *  matching a space). undefined: none does. */
export function grantOf(grants: readonly string[] | undefined, text: string): string | undefined {
  return grants?.find((g) => {
    if (GRANT_WORDS[g]?.test(text)) return true
    const word = g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]')
    return new RegExp(`(?<![\\w-])${word}(?![\\w-])`, 'i').test(text)
  })
}

/** The Gate kind of a convergence review that found a blocker no code change fixes (a dev server, a scope decision, a permission). */
const REVIEW_NEEDS_DECISION = 'review-needs-decision'

/** The standing grants of the project of the question's plan. */
const grantsOf = (s: OrchState, q: OpenQuestion): string[] | undefined => {
  const run = s.runs.find((r) => r.id === q.runId)
  const job = run && s.jobs.find((j) => j.id === run.jobId)
  return job && projectOfJob(s, job)?.grants
}

/** T5: the answer to a guardrail question a standing grant covers: the asker writes the grant itself. */
export const grantedAnswer = (kind: string): string =>
  `The owner granted ${kind} in advance. Write the grant yourself the way this repository's own policy asks ` +
  "(its CLAUDE.md/AGENTS.md or the Task's instructions), note it in your summary, and continue; do not escalate it."

const firstLine = (text: string, max: number): string => {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? text.trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

/**
 * #117: the steps due now for the open questions of hands-off plans, whatever the global `autoAnswer` setting. A Gate
 * whose attempts or review rounds ran out is answered `retry-once`, and once its Task was retried `mark-failed`, so the
 * plan carries on. A guardrail case (`refusedHandsOff`) is refused, never asked, and the Task that needs it is held for
 * the owner (`hold`), so the rest of the plan finishes without it. An ask or escalation waits out
 * `ASK_GRACE_MS` for its coordinator first; what has no safe answer then goes to the coordinator to decide.
 */
export function handsOffStepsDue(s: OrchState, open: OpenQuestion[], nowMs: number): HandsOffStep[] {
  return open.flatMap((q): HandsOffStep[] => {
    if (ownersOnly(q)) return []
    if (q.source !== undefined && nowMs - Date.parse(q.createdAt) < ASK_GRACE_MS) return []
    const retried = retriedOf(s, q)
    const asked = firstLine(q.question, 300)
    const answer = (a: AutoAnswer, kind: Decision['kind'], why: string, hold?: { taskId: string; reason: string }): HandsOffStep[] => [
      { kind: 'answer', answer: a, decision: { kind, ...(q.taskId ? { taskId: q.taskId } : {}), question: asked, choice: firstLine(a.answer, 200), why }, ...(hold ? { hold } : {}) }
    ]
    const options = q.options ?? []
    const option = (re: RegExp): string | undefined => options.find((o) => re.test(o.trim()))
    // T11: a worker's scope question is settled from the plan's design, before its permission words could hold it
    const scoped = scopeStepOf(s, q)
    if (scoped) return answer(scoped, 'escalation', SCOPE_WHY)
    if (q.kind === REVIEW_NEEDS_DECISION) {
      // A guardrail other than a permission ask stays the owner's whatever is granted; its Task is held, the plan goes on
      if (OWNER_ONLY.some((re) => re !== PERMISSION && re.test(q.question))) {
        if (!q.taskId) return [{ kind: 'coordinator', question: q }]
        const hold = { taskId: q.taskId, reason: `Waiting on the owner's decision: ${asked}` }
        const why = 'a guardrail: only the owner decides this, and the plan runs hands-off'
        return [{ kind: 'hold', id: q.id, decision: { kind: 'refused', taskId: q.taskId, question: asked, choice: firstLine(REFUSED_ANSWER, 200), why }, hold }]
      }
      const granted = grantOf(grantsOf(s, q), q.question)
      if (granted) return answer({ id: q.id, answer: grantedAnswer(granted), why: 'Host state' }, 'gate', `the owner granted ${granted} in advance`)
      return [{ kind: 'coordinator', question: q }]
    }
    // A Gate the Host wrote itself, its tries spent: one more, then given up, so the plan reaches its end
    if (q.kind) {
      const retry = retried ? undefined : option(/^retry-once$/i)
      if (retry) return answer({ id: q.id, answer: retry, why: 'safe default' }, 'gate', 'the attempts ran out: one more try')
      const failed = option(/^mark-failed$/i)
      if (failed) return answer({ id: q.id, answer: failed, why: 'safe default' }, 'gate', 'it was retried once already: marked failed so the plan carries on')
    } else if (refusedHandsOff(q)) {
      // T5: a standing grant covers it: answered back with the grant to write, not refused
      // only a permission ask: deleting data, the default branch, money or credentials stay the owner's whatever is granted
      const granted = OWNER_ONLY.some((re) => re !== PERMISSION && re.test(q.question)) ? undefined : grantOf(grantsOf(s, q), q.question)
      if (granted) return answer({ id: q.id, answer: grantedAnswer(granted), why: 'Host state' }, 'escalation', `the owner granted ${granted} in advance`)
      const no = REFUSAL.map(option).find((o) => o !== undefined)
      // The Task that needs it waits for the owner; the rest of the plan goes on
      const hold = q.taskId ? { taskId: q.taskId, reason: `Waiting on the owner's decision: ${asked}` } : undefined
      const why = "a guardrail: only the owner decides this, and the plan runs hands-off"
      // No worker waits on an escalation: it stays open for the owner, and once its Task is held it is theirs alone
      if (hold && q.source === 'escalation') {
        const task = s.tasks.find((t) => t.id === q.taskId)
        if (task?.status === 'blocked' && !s.gates.some((g) => g.taskId === task.id && g.status === 'open')) return []
        return [{ kind: 'hold', id: q.id, decision: { kind: 'refused', taskId: hold.taskId, question: asked, choice: firstLine(no ?? REFUSED_ANSWER, 200), why }, hold }]
      }
      return answer({ id: q.id, answer: no ?? REFUSED_ANSWER, why: 'safe default' }, 'refused', why, hold)
    }
    const a = autoAnswerOf(s, q, retried)
    if (a) return answer(a, q.source === undefined ? 'gate' : 'escalation', a.why)
    return [{ kind: 'coordinator', question: q }]
  })
}

/** #117: the message that hands a hands-off plan's open question to its coordinator. */
export function coordinatorDecideBody(q: OpenQuestion): string {
  const head = `Question ${q.id}${q.taskId ? ` (task ${q.taskId})` : ''}: ${q.question.slice(0, 1500)}\n`
  const tail = `\nAnswer with \`astera questions answer --id ${q.id} --answer "<your decision and why>"\`.`
  if (q.kind === REVIEW_NEEDS_DECISION) {
    return (
      `This plan runs hands-off. A review found something no code change fixes. Decide in the owner's place, within the guardrails: ` +
      `extend the Task's scope (say what the worker may now do, e.g. start the dev server itself), grant the standing permission, ` +
      `or pick an option (e.g. accept the proof another way, or drop that criterion). ` +
      `Your answer is put verbatim into the repair worker's prompt, so write it as an instruction to that worker.\n\n` +
      head +
      tail
    )
  }
  return (
    `This plan runs hands-off: decide this question in the owner's place, within the guardrails.\n\n` +
    head +
    (q.options?.length ? `Options: ${q.options.join(', ')}\n` : '') +
    tail
  )
}

/** The feed line: "Auto-answered: hold — W9-B Coordinator answers (safe default)". */
export function autoAnswerLine(s: OrchState, q: Pick<OpenQuestion, 'taskId'>, a: AutoAnswer): string {
  const task = s.tasks.find((t) => t.id === q.taskId)
  const answer = a.answer.length > 160 ? `${a.answer.slice(0, 157)}...` : a.answer
  return `Auto-answered: ${answer} — ${task?.title ?? q.taskId} (${a.why})`
}

/** T11: the owner-only categories besides a plain permission ask: deleting data, the default branch, force-push, money,
 *  credentials, "ask me". What a scope question must not touch (scopeDecider.ts). */
const guardedBesidesPermission = (text: string): boolean => OWNER_ONLY.some((re) => re !== PERMISSION && re.test(text))

/** T11: what a worker's scope question is judged against: its plan's repository, the Run's worktree and the worktrees
 *  its Task's workers ran in, and the Task's affected paths. */
function scopeContextOf(s: OrchState, q: OpenQuestion): ScopeContext {
  const run = s.runs.find((r) => r.id === q.runId)
  const job = run && s.jobs.find((j) => j.id === run.jobId)
  const task = s.tasks.find((t) => t.id === q.taskId)
  const roots = [job?.cwd, run?.worktree, ...s.dispatches.filter((d) => d.taskId === q.taskId).map((d) => d.cwd)]
  return {
    roots: roots.filter((r): r is string => typeof r === 'string' && r !== ''),
    ...(task?.affectedPaths ? { affectedPaths: task.affectedPaths } : {}),
    guarded: guardedBesidesPermission
  }
}

/** T11: the answer to a worker's ask or escalation in a hands-off plan that asks to work outside its Task's paths, or
 *  null when it is not one. A Task whose own text says "ask me" keeps its questions for the owner. */
function scopeStepOf(s: OrchState, q: OpenQuestion): AutoAnswer | null {
  if (q.source !== 'ask' && q.source !== 'escalation') return null
  const task = s.tasks.find((t) => t.id === q.taskId)
  if (task && /\bask me\b/i.test(`${task.prompt ?? ''}\n${task.spec}`)) return null
  const text = scopeAnswerOf(q, scopeContextOf(s, q))
  return text === null ? null : { id: q.id, answer: text, why: 'safe default' }
}

/** T11: how long a hands-off plan with no live coordinator waits for its planner to answer a worker's question, before
 *  the question gets ESCALATION_DEFAULT_ANSWER. */
export const PLANNER_ANSWER_WAIT_MS = 5 * 60_000

/** T11: the answer a worker's question gets when neither a coordinator nor the plan's planner decided it in time. */
export const ESCALATION_DEFAULT_ANSWER =
  "Proceed with the option that keeps to your Task's spec and the plan's decisions; record the choice in your report."
