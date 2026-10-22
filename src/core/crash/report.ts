// T27: a crash report, from the error to the GitHub issue a person may choose to open. Pure: the files live in
// store.ts, the handlers in main/crashReports.ts and host/log.ts. A report never holds an error's message (it can
// carry a token): only its name and its stack frames, redacted, with where it ran.
import { redact } from './redact'

/** Where Send points: a new issue on the fork, opened in the browser. Nothing is sent by the app itself. */
export const ISSUE_NEW_URL = 'https://github.com/JanoTheDev/astera-orchestrator/issues/new'
/** Below what browsers and GitHub take in one URL (~8 KB), with room to spare. */
export const MAX_ISSUE_URL = 7500
export const MAX_FRAMES = 20
export const LOG_LINES = 30
export const KEEP_DAYS = 30
export const KEEP_FILES = 20
const NAME_MAX = 80

export type CrashProcess = 'main' | 'renderer' | 'host' | 'child'

/** `ask`: offer each report once; `never`: keep reports on disk only (30 days at most). */
export type CrashReportsSetting = 'ask' | 'never'
/** app-settings.json is user-editable: only an explicit 'never' turns the prompt off. */
export const crashReportsOf = (v: unknown): CrashReportsSetting => (v === 'never' ? 'never' : 'ask')

export interface CrashEnv {
  version: string
  /** The commit the app was built from, or '' */
  build: string
  os: string
  arch: string
  /** Replaced by ~ wherever it appears */
  home?: string
}

export interface CrashReport {
  at: string
  version: string
  build: string
  os: string
  arch: string
  process: CrashProcess
  /** What caught it: uncaughtException, unhandledRejection, render-process-gone, error, … */
  kind: string
  errorName: string
  stack: string[]
  log: string[]
  /** Set once the prompt has offered it, so a report is offered at most once */
  offered?: boolean
}

/** What the renderer sends for its own error: a name and a stack, never the message. */
export interface ErrorShape {
  name?: unknown
  stack?: unknown
}

/** The `at …` lines of a stack, trimmed, at most `max`. The first line (`Name: message`) is never one of them. */
export const framesOf = (stack: string, max = MAX_FRAMES): string[] =>
  stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, max)

export function reportOf(a: {
  process: CrashProcess
  kind: string
  error: unknown
  env: CrashEnv
  at?: Date
  log?: string
  logLines?: number
}): CrashReport {
  const e = a.error
  const shaped = typeof e === 'object' && e !== null ? (e as ErrorShape) : null
  const name =
    e instanceof Error ? e.name : shaped && typeof shaped.name === 'string' ? shaped.name : typeof e
  const stack = shaped && typeof shaped.stack === 'string' ? shaped.stack : ''
  const r = (s: string): string => redact(s, a.env.home)
  const log = a.log === undefined ? [] : a.log.split('\n').filter((l) => l.trim() !== '').slice(-(a.logLines ?? LOG_LINES))
  return {
    at: (a.at ?? new Date()).toISOString(),
    version: a.env.version,
    build: a.env.build,
    os: a.env.os,
    arch: a.env.arch,
    process: a.process,
    kind: a.kind,
    errorName: r(name).slice(0, NAME_MAX),
    stack: framesOf(stack).map(r),
    log: log.map(r)
  }
}

/** The issue body: exactly the text the prompt shows and Send would put in the URL (before any cut). */
export function formatReport(r: CrashReport): string {
  const lines = [
    `**${r.errorName}** in the ${r.process} process (${r.kind})`,
    '',
    `- Version: ${r.version}${r.build ? ` (${r.build})` : ''}`,
    `- OS: ${r.os} ${r.arch}`,
    `- When: ${r.at}`,
    '',
    'Stack (redacted, no error message):',
    '```',
    ...(r.stack.length > 0 ? r.stack : ['(none)']),
    '```'
  ]
  if (r.log.length > 0) lines.push('', 'Last log lines (redacted):', '```', ...r.log, '```')
  return lines.join('\n')
}

const TRUNCATED = '\n…(truncated)'
const urlOf = (title: string, body: string): string =>
  `${ISSUE_NEW_URL}?${new URLSearchParams({ title, body }).toString()}`

/** The issue a Send opens: title, body (cut to fit, the cut marked) and the URL holding both. */
export function issueOf(r: CrashReport): { title: string; body: string; url: string; truncated: boolean } {
  const title = `Crash: ${r.errorName} in ${r.process} (${r.kind}) on ${r.version}`
  const full = formatReport(r)
  let body = full
  let url = urlOf(title, body)
  while (url.length > MAX_ISSUE_URL && body.length > 0) {
    // One body character is 1 to 9 URL characters once encoded, so a third of the excess per round ends in a few rounds
    const cut = Math.max(20, Math.ceil((url.length - MAX_ISSUE_URL) / 3))
    body = full.slice(0, Math.max(0, body.length - TRUNCATED.length - cut)) + TRUNCATED
    url = urlOf(title, body)
  }
  return { title, body, url, truncated: body !== full }
}

/** Which report files to delete: older than 30 days, or past the newest 20. */
export function toPrune(files: Array<{ name: string; mtimeMs: number }>, now: number): string[] {
  const cutoff = now - KEEP_DAYS * 86_400_000
  const newest = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  return newest.filter((f, i) => i >= KEEP_FILES || f.mtimeMs < cutoff).map((f) => f.name)
}

/** What the prompt shows and Send opens: the report's issue, exactly. `ask` is false while the setting is never
 *  (the prompt then opens only from ErrorScreen's Report button). */
export interface CrashOffer {
  id: string
  title: string
  body: string
  ask: boolean
}

/** Renderer error kinds main accepts: window `error`, `unhandledrejection`, and ErrorBoundary's `render` */
export const RENDERER_KINDS = ['error', 'unhandledrejection', 'render'] as const
