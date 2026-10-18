// W9-I: what a tab did, once it ended (DESIGN §4). The facts are folded here from what Astera already holds;
// the 2–3 sentences of prose are asked of a cheap model by src/host/hostSummaries.ts, from these facts.
//
// Pure: no clock, no files, no model. node: only type imports, so the renderer and the Host both read it.
import type { Dispatch, Gate, Task } from '../orchestration/types'
import type { SessionCheck } from '../understanding/types'

export type SummaryOutcome = 'merged' | 'gave-up' | 'stopped' | 'done'

export interface SummaryFile {
  path: string
  /** Absent when only the file's name is known (a Task's reported `filesModified`). */
  added?: number
  removed?: number
}

export interface SummaryFacts {
  /** The tab's role: a Task's worker, or a plain session. */
  role: 'worker' | 'session'
  /** The Task's title, else the session's. */
  title: string
  files: SummaryFile[]
  /** The checks the agent reported and Astera ran, by name. */
  checks: SessionCheck[]
  /** Reviewer rounds the Task went through, and where the last one left it. */
  review: { rounds: number; verdict: 'approved' | 'changes-requested' | 'none' }
  /** Questions the tab raised: answered by the coordinator, by the owner. */
  questions: { coordinator: number; owner: number }
  /** Commit subjects (newest last) and the plan's PR, when there is one. */
  commits: string[]
  pr?: string
}

export interface SessionSummary {
  sessionId: string
  /** The agent CLI's own conversation id, which History rows are keyed by. */
  agentSessionId?: string
  jobId?: string
  taskId?: string
  /** ISO time the tab ended. */
  at: string
  outcome: SummaryOutcome
  durationMs: number
  facts: SummaryFacts
  /** 2–3 sentences, or '' when the model was unavailable, failed or timed out (never retried). */
  text: string
  /** The model that wrote `text`; absent with no prose. */
  model?: string
}

/** The line a card shows beside the title: "Merged · 2 rounds". */
export function outcomeLabel(s: Pick<SessionSummary, 'outcome' | 'facts'>): string {
  const rounds = s.facts.review.rounds
  if (s.outcome === 'merged') return rounds > 1 ? `Merged · ${rounds} rounds` : 'Merged'
  return { 'gave-up': 'Gave up', stopped: 'Stopped', done: 'Done' }[s.outcome]
}

const FILES_MAX = 30
const COMMITS_MAX = 10
const CHECKS_MAX = 20

const checkStatusOf = (s: string): SessionCheck['status'] => (s === 'passed' ? 'passed' : s === 'not-run' ? 'skipped' : 'failed')

export interface SummaryInput {
  session: { id: string; title: string; startedAt?: string }
  /** When the tab ended. */
  endedAt: string
  task?: Task
  /** All of the Task's Dispatches, workers and reviewers. */
  dispatches?: readonly Dispatch[]
  gates?: readonly Gate[]
  /** The activity lines of this Task (`question.auto-answered`, `gate.resolved`). */
  activity?: readonly { type: string; taskId?: string; payload: { answeredBy?: 'owner' } }[]
  /** `SessionWorkUnit.checks`: what the agent reported running. */
  unitChecks?: readonly SessionCheck[]
  /** Files with +/-, from git diff or W8 attribution. */
  diff?: readonly SummaryFile[]
  commits?: readonly string[]
  pr?: string
  jobId?: string
}

/** Outcome, duration and facts of one ended tab. */
export function summaryFactsOf(i: SummaryInput): Pick<SessionSummary, 'outcome' | 'durationMs' | 'facts'> {
  const { task } = i
  const mine = (i.dispatches ?? []).filter((d) => d.sessionId === i.session.id)
  const closedBy = mine.find((d) => d.closedBy !== undefined)?.closedBy
  const outcome: SummaryOutcome =
    task?.status === 'completed' ? 'merged' : task?.status === 'failed' ? 'gave-up' : closedBy !== undefined ? 'stopped' : 'done'

  const rounds = (i.dispatches ?? []).filter((d) => d.review === true).length
  const open = task?.reviewIssues?.some((x) => x.blocking) === true
  const verdict = rounds === 0 ? 'none' : open ? 'changes-requested' : 'approved'

  const byName = new Map<string, SessionCheck>()
  for (const c of i.unitChecks ?? []) byName.set(c.name, c)
  for (const c of task?.checks ?? []) byName.set(c.name, { name: c.name, status: checkStatusOf(c.status) })

  const taskId = task?.id
  const events = (i.activity ?? []).filter((e) => taskId === undefined || e.taskId === taskId)
  const owner =
    events.filter((e) => e.type === 'question.auto-answered' && e.payload.answeredBy === 'owner').length +
    events.filter((e) => e.type === 'gate.resolved').length
  const coordinator = events.filter((e) => e.type === 'question.auto-answered' && e.payload.answeredBy !== 'owner').length

  const start = Date.parse(i.session.startedAt ?? mine[0]?.startedAt ?? '')
  const end = Date.parse(i.endedAt)
  const durationMs = Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, end - start)

  return {
    outcome,
    durationMs,
    facts: {
      role: task ? 'worker' : 'session',
      title: task?.title ?? i.session.title,
      files: (i.diff ?? []).slice(0, FILES_MAX).map((f) => ({ ...f })),
      checks: [...byName.values()].slice(0, CHECKS_MAX),
      review: { rounds, verdict },
      questions: { coordinator, owner },
      commits: (i.commits ?? []).slice(-COMMITS_MAX),
      ...(i.pr !== undefined ? { pr: i.pr } : {})
    }
  }
}

const TAIL_CHARS = 2000
const PROSE_MAX = 700

/** What the model is asked: facts, the agent's own summary and the tail of the session. It answers one JSON object,
 *  the shape `core/understanding/agent.ts` reads. */
export function summaryPrompt(a: { facts: SummaryFacts; outcome: SummaryOutcome; resultSummary?: string; tail?: string; lang?: string }): string {
  const f = a.facts
  const lines = [
    'Write a short card for a coding-agent tab that just ended, for its owner to read later.',
    'Say what it did and anything left open, in 2 to 3 plain sentences. Use only the facts below. Do not invent files, results or intent.',
    `Answer with one JSON object: {"text": "<the sentences>"}.${a.lang ? ` Write in this language: ${a.lang}.` : ''}`,
    '',
    `Title: ${f.title}`,
    `Outcome: ${a.outcome}`,
    `Files: ${f.files.map((x) => (x.added === undefined ? x.path : `${x.path} (+${x.added} -${x.removed ?? 0})`)).join(', ') || 'none'}`,
    `Checks: ${f.checks.map((c) => `${c.name} ${c.status}`).join(', ') || 'none reported'}`,
    `Review: ${f.review.rounds} rounds, ${f.review.verdict}`,
    `Questions: ${f.questions.coordinator} answered by the coordinator, ${f.questions.owner} by the owner`,
    `Commits: ${f.commits.join('; ') || 'none'}`
  ]
  if (a.resultSummary) lines.push('', `The agent's own summary: ${a.resultSummary}`)
  if (a.tail) lines.push('', 'The last messages of the tab:', a.tail.slice(-TAIL_CHARS))
  return lines.join('\n')
}

/** The prose from the model's answer: a trimmed `text` string, else null (the card then shows facts only). */
export function proseOf(value: unknown): string | null {
  const text = (value as { text?: unknown } | null)?.text
  if (typeof text !== 'string') return null
  const t = text.trim()
  return t === '' ? null : t.slice(0, PROSE_MAX)
}

/** One card as a plain line: "Title — Merged · 2 rounds. 3 files, checks 2/2. Prose." */
function cardLine(s: SessionSummary): string {
  const f = s.facts
  const passed = f.checks.filter((c) => c.status === 'passed').length
  const bits = [`${f.files.length} file${f.files.length === 1 ? '' : 's'}`, ...(f.checks.length > 0 ? [`checks ${passed}/${f.checks.length}`] : [])]
  return `- **${f.title}** — ${outcomeLabel(s)}. ${bits.join(', ')}.${s.text ? ` ${s.text.replace(/\s+/g, ' ')}` : ''}`
}

/** The plan roll-up: the PR body's "What each task did" block, and Overview's "What happened so far". Empty string
 *  with nothing to say, so a caller appends it unconditionally. Only ids' facts and the prose go in: nothing the
 *  session store does not already keep. */
export function rollupMarkdown(summaries: readonly SessionSummary[]): string {
  const rows = summaries.filter((s) => s.facts.role === 'worker').sort((a, b) => a.at.localeCompare(b.at))
  return rows.length === 0 ? '' : ['## What each task did', '', ...rows.map(cardLine)].join('\n')
}
