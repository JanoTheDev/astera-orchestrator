// The completion check plugin contract (plugin Phase 5 C3-C5, C10): the id a Task's check list names a plugin by, the
// input Astera asks with, what the Host makes of the answer, and the text a repair request and a status message carry.
//
// **The answer is checked and cut here, once, for every caller**: the Host's runtime path and the app's path through
// `checks-plugin-run` both pass what they received through `checkAnswerOf`, so a check result in the state has the same
// limits whoever drove it. A plugin is third-party code; what it answers reaches a worker's spec and a person's screen.
//
// Pure, and type-only imports from the state: state.ts imports this module.
import type { CompletionCheckInput } from '../pluginContract'
import { clip, webUrl } from '../sources/answers'
import type { OrchState } from './state'
import type { CheckDiagnostic, CheckResult, Task } from './types'

export type { CheckDiagnostic } from './types'
export type { CompletionCheckInput }

/** A Task's check list names a plugin's check as `plugin:<pluginId>` (C6). */
export const PLUGIN_CHECK_PREFIX = 'plugin:'

/** The plugin a check id names, or null for a run configuration's id. */
export function pluginIdOfCheck(configId: string): string | null {
  if (!configId.startsWith(PLUGIN_CHECK_PREFIX)) return null
  const id = configId.slice(PLUGIN_CHECK_PREFIX.length)
  return id === '' ? null : id
}

/** A plugin check's answer as Astera keeps it (C4, C5), named by the plugin's display name. */
export interface PluginCheckAnswer {
  name: string
  status: 'passed' | 'failed' | 'error'
  summary: string
  diagnostics?: CheckDiagnostic[]
  /** How many findings the plugin gave, when the Host kept fewer (CHECK_DIAGNOSTICS_MAX) */
  diagnosticsTotal?: number
  externalUrl?: string
}

export const CHECK_SUMMARY_MAX = 1_000
/** How many findings of a check the Host keeps (C5 said 100; 5d, from the performance review, keeps what a repair request
 *  names): they travel in the state, every completion read and the repair request, and the plugin's link holds the rest. */
export const CHECK_DIAGNOSTICS_MAX = 20
export const CHECK_MESSAGE_MAX = 1_000
export const CHECK_FILE_MAX = 500
/** How many findings a repair request and a status message name (C10); the rest are counted. */
export const REPAIR_DIAGNOSTICS = 20

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const STATUSES: ReadonlySet<string> = new Set(['passed', 'failed', 'error'])

/** Why plugin `id` cannot make a Task's check (C7), or null when it can: not installed, not offering completion checks,
 *  or disabled. Whether it runs now is the runtime's to say, when it is asked. */
export function pluginCheckMissing(id: string, p: { check: boolean; enabled: boolean } | undefined): string | null {
  if (p === undefined) return `no plugin ${id} is installed`
  if (!p.check) return `${id} does not offer completion checks`
  if (!p.enabled) return `${id} is disabled`
  return null
}

/** A check that could not be made, for the reason given (C5). */
export const unavailable = (reason: string): Omit<PluginCheckAnswer, 'name'> => ({
  status: 'error',
  summary: clip(reason.trim() === '' ? 'error' : reason, CHECK_SUMMARY_MAX)
})

const wrongShape = (why: string): Omit<PluginCheckAnswer, 'name'> =>
  unavailable(`the plugin answered with something that is not a check result: ${why}`)

/** One finding, its message required and the rest kept when they are what they say (C5), or null when it has no message. */
function diagnosticOf(v: unknown): CheckDiagnostic | null {
  if (!isObject(v) || typeof v.message !== 'string' || v.message.trim() === '') return null
  const line = v.line
  return {
    ...(typeof v.file === 'string' && v.file !== '' ? { file: clip(v.file, CHECK_FILE_MAX) } : {}),
    ...(typeof line === 'number' && Number.isInteger(line) && line > 0 ? { line } : {}),
    message: clip(v.message, CHECK_MESSAGE_MAX),
    ...(v.severity === 'error' || v.severity === 'warning' ? { severity: v.severity } : {})
  }
}

/**
 * What the Host keeps of a plugin's answer (C5): the summary within 1,000 characters (the status word when there is
 * none), at most 20 findings (`diagnosticsTotal` then says how many there were), each message within 1,000, each file within
 * 500, a line only when it is a positive integer, a severity only when it is one of the two, and a link only when it is
 * http or https within 2,048 characters. An answer of the wrong shape is `error`, saying why: the plugin's author reads
 * that in the question a person is asked.
 */
export function checkAnswerOf(raw: unknown): Omit<PluginCheckAnswer, 'name'> {
  if (!isObject(raw)) return wrongShape('the answer is not an object')
  const status = raw.status
  if (typeof status !== 'string' || !STATUSES.has(status)) return wrongShape('status must be passed, failed or error')
  if (raw.summary !== undefined && typeof raw.summary !== 'string') return wrongShape('summary must be text')
  if (raw.diagnostics !== undefined && !Array.isArray(raw.diagnostics)) return wrongShape('diagnostics must be a list')
  const given = (raw.diagnostics ?? []) as unknown[]
  const diagnostics: CheckDiagnostic[] = []
  for (const d of given.slice(0, CHECK_DIAGNOSTICS_MAX)) {
    const kept = diagnosticOf(d)
    if (kept === null) return wrongShape('each diagnostic needs a message')
    diagnostics.push(kept)
  }
  const said = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary : status
  // The plugin may say how many it found rather than send them all (5d); a count below what it sent changes nothing
  const claimed = typeof raw.diagnosticsTotal === 'number' && Number.isSafeInteger(raw.diagnosticsTotal) ? raw.diagnosticsTotal : 0
  const total = Math.max(given.length, claimed)
  const link = webUrl(raw.externalUrl)
  return {
    status: status as PluginCheckAnswer['status'],
    summary: clip(said, CHECK_SUMMARY_MAX),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(total > diagnostics.length ? { diagnosticsTotal: total } : {}),
    ...(link !== undefined ? { externalUrl: link } : {})
  }
}

/** The words a skipped check's record starts with, before the reason it could not be made (C9 `skip-check`). */
export const SKIPPED_PREFIX = 'Skipped by a person: '

/** A check that could not be made, as a round a person let go on without it keeps it (C9 `skip-check`): not run,
 *  marked skipped, the reason it could not be made in its words. */
export function skippedResult(c: CheckResult): CheckResult {
  return {
    configId: c.configId,
    name: c.name,
    status: 'not-run',
    skipped: true,
    summary: clip(`${SKIPPED_PREFIX}${c.summary ?? 'it could not be made'}`, CHECK_SUMMARY_MAX)
  }
}

/** The reason a skipped check could not be made, without the words its record says it with: a screen says "skipped"
 *  in its own language. Any other summary is given back as it is. */
export const skipReasonOf = (summary: string | undefined): string | undefined =>
  summary !== undefined && summary.startsWith(SKIPPED_PREFIX) ? summary.slice(SKIPPED_PREFIX.length) : summary

/** A plugin's text on one line, for a place that promises one (`failureSummary`, a row of `runs checks --human`): its
 *  line breaks, with the spaces around them, become one space. */
export const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** How many findings a check gave: its count when the Host kept fewer (5d), else the ones it has. */
export const findingsCountOf = (c: { diagnostics?: readonly unknown[]; diagnosticsTotal?: number }): number =>
  Math.max(c.diagnosticsTotal ?? 0, c.diagnostics?.length ?? 0)

/** One finding as a repair request names it: `file:line message`, a warning said as one. */
export function diagnosticLine(d: CheckDiagnostic): string {
  const where = d.file === undefined ? '' : `${d.file}${d.line !== undefined ? `:${d.line}` : ''} `
  return `${where}${d.severity === 'warning' ? 'warning: ' : ''}${d.message}`
}

/** A plugin check's result as text (C10): its summary, its first 20 findings, how many more, and its link. Null for a
 *  command check, whose text is its output. */
export function pluginCheckText(c: CheckResult): string | null {
  if (c.summary === undefined) return null
  const lines = [c.summary]
  const found = c.diagnostics ?? []
  const shown = found.slice(0, REPAIR_DIAGNOSTICS)
  for (const d of shown) lines.push(diagnosticLine(d))
  const more = findingsCountOf(c) - shown.length
  if (more > 0) lines.push(`… ${more} more finding(s)`)
  if (c.externalUrl !== undefined) lines.push(`Details: ${c.externalUrl}`)
  return lines.join('\n')
}

/** The input for one Task's check in `cwd` (C3). The commits are the Host's record of its attempts (Dispatch.git): the
 *  base of its first, falling back to its Run's, and the head of its last. `branch` is left to the plugin, which can ask
 *  git in `root`: nothing in the state names it. */
export function checkInputOf(s: OrchState, task: Task, cwd: string): CompletionCheckInput {
  const run = s.runs.find((r) => r.id === task.runId)
  const job = run ? s.jobs.find((j) => j.id === run.jobId) : undefined
  const attempts = s.dispatches
    .filter((d) => d.taskId === task.id && !d.review)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const base = attempts[0]?.git?.base ?? run?.git?.base
  const head = attempts.at(-1)?.git?.head
  return {
    ...(job?.projectId !== undefined ? { projectId: job.projectId } : {}),
    jobId: run?.jobId ?? '',
    runId: task.runId ?? '',
    taskId: task.id,
    task: { title: task.title },
    workspace: { root: cwd, ...(base !== undefined ? { base } : {}), ...(head !== undefined ? { head } : {}) }
  }
}
