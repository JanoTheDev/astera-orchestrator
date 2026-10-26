// T27: the main process's crash reporter. Main's own failures (an uncaught exception, an unhandled rejection) and a
// renderer or child process that went away are written as redacted reports to <userData>/crash-reports/ (core/crash);
// the renderer sends its own errors over IPC. Nothing leaves the machine from here: Send opens a prefilled GitHub
// issue in the browser, and only for a report the person was shown and said yes to.
import path from 'node:path'
import { fingerprintOf, issueOf, reportOf, RENDERER_KINDS, type CrashEnv, type CrashOffer, type CrashProcess, type CrashReportsSetting } from '../core/crash/report'
import { CRASH_DIR, markOffered, nodeCrashEnv, pendingReports, readReport, tailSync, writeReportSync } from '../core/crash/store'
import { flushAllLogsSync } from '../core/log/logWriter'
import { lowerForOom } from './overloadLimits'

export interface CrashReportsDeps {
  dir: string
  env: CrashEnv
  setting: () => CrashReportsSetting
  openExternal: (url: string) => unknown
  /** The main process's log file; the end of it rides in every main report, as host.log does in the Host's */
  logPath?: string
  /** Where a report that could not be written is told (a log); never the error's message */
  log?: (m: string) => void
}

export type CrashReports = ReturnType<typeof createCrashReports>

const STACK_MAX = 20_000

export function createCrashReports(d: CrashReportsDeps) {
  // The same failure twice in one run (a rejection in a loop, an error on every frame, the same error from the
  // boundary and the window) is one report: its fingerprint keeps the id of the report it made
  const seen = new Map<string, string>()

  /** The end of the main log, flushed first so the lines just before a crash are in it. */
  function mainLogTail(): string | undefined {
    if (!d.logPath) return undefined
    flushAllLogsSync()
    return tailSync(d.logPath)
  }

  /** Writes a report; its id. A repeat gets the id of the first report and writes nothing. null when the disk
   *  refused. Synchronous, never throws. */
  function record(process: CrashProcess, kind: string, error: unknown): string | null {
    try {
      const report = reportOf({ process, kind, error, env: d.env, log: process === 'main' ? mainLogTail() : undefined })
      const key = fingerprintOf(report)
      const first = seen.get(key)
      if (first) return first
      const id = writeReportSync(d.dir, report)
      seen.set(key, id)
      return id
    } catch (err) {
      d.log?.(`crash report could not be written (${err instanceof Error ? err.name : typeof err})`)
      return null
    }
  }

  async function offerOf(id: string): Promise<CrashOffer | null> {
    const report = await readReport(d.dir, id)
    if (!report) return null
    const { title, body } = issueOf(report)
    return { id, title, body, ask: d.setting() === 'ask' }
  }

  return {
    record,

    /** A renderer error (IPC, so checked): written, marked offered (the renderer shows it now), and handed back. A
     *  repeat of an error already reported this run is the same report, handed back without asking again. */
    async fromRenderer(payload: unknown): Promise<CrashOffer | null> {
      if (typeof payload !== 'object' || payload === null) return null
      const p = payload as { kind?: unknown; name?: unknown; stack?: unknown }
      if (!(RENDERER_KINDS as readonly unknown[]).includes(p.kind)) return null
      const error = {
        name: typeof p.name === 'string' ? p.name : 'Error',
        stack: typeof p.stack === 'string' ? p.stack.slice(0, STACK_MAX) : ''
      }
      const id = record('renderer', p.kind as string, error)
      if (!id) return null
      const before = await readReport(d.dir, id)
      await markOffered(d.dir, id)
      const offer = await offerOf(id)
      return offer && before?.offered ? { ...offer, ask: false } : offer
    },

    /** Reports from before (a crash that ended the last run), each offered once. None while the setting is never. */
    async pending(): Promise<CrashOffer[]> {
      if (d.setting() === 'never') return []
      const out: CrashOffer[] = []
      for (const { id } of await pendingReports(d.dir)) {
        await markOffered(d.dir, id)
        const offer = await offerOf(id)
        if (offer) out.push(offer)
      }
      return out
    },

    /** The person pressed Send: the issue page opens in the browser. The URL is built here from the file, never
     *  taken from the renderer. */
    async send(id: unknown): Promise<boolean> {
      if (typeof id !== 'string') return false
      const report = await readReport(d.dir, id)
      if (!report) return false
      await d.openExternal(issueOf(report).url)
      return true
    }
  }
}

interface ProcessLike {
  on(event: 'uncaughtExceptionMonitor', l: (err: unknown, origin: string) => void): unknown
  on(event: 'unhandledRejection', l: (reason: unknown) => void): unknown
}
interface AppLike {
  on(event: 'render-process-gone', l: (e: unknown, wc: unknown, details: { reason: string }) => void): unknown
  on(event: 'child-process-gone', l: (e: unknown, details: { type: string; reason: string }) => void): unknown
}

/** T5: an out-of-memory exit lowers the limits; a failure there never escapes the event handler. */
function limitOnOom(onOom: ((what: string) => void) | undefined, what: string): void {
  try {
    onOom?.(what)
  } catch (err) {
    console.error(`oom limit lowering failed (${err instanceof Error ? err.name : typeof err})`)
  }
}

/** Main's handlers. `uncaughtExceptionMonitor` only watches: Electron still does what it did with the exception. An
 *  unhandled rejection is still printed (by name: a message can carry a token). A process that ended cleanly is no crash. */
export function registerCrashReports(
  proc: ProcessLike,
  app: AppLike,
  reports: Pick<CrashReports, 'record'>,
  onOom?: (what: 'renderer' | string) => void
): void {
  proc.on('uncaughtExceptionMonitor', (err) => {
    reports.record('main', 'uncaughtException', err)
  })
  proc.on('unhandledRejection', (reason) => {
    console.error(`unhandled rejection (${reason instanceof Error ? reason.name : typeof reason})`)
    reports.record('main', 'unhandledRejection', reason)
  })
  app.on('render-process-gone', (_e, _wc, details) => {
    if (details.reason === 'clean-exit') return
    reports.record('renderer', 'render-process-gone', { name: details.reason })
    if (details.reason === 'oom') limitOnOom(onOom, 'renderer')
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    reports.record('child', 'child-process-gone', { name: `${details.type} ${details.reason}` })
    if (details.reason === 'oom') limitOnOom(onOom, details.type)
  })
}

/** index.ts's one call: the reporter for <userData>/crash-reports/, main's handlers, and the renderer's channels
 *  (crash.report for its own errors, crash.pending at start, crash.send behind the prompt's Send). */
export function installCrashReports(a: {
  proc: ProcessLike
  app: AppLike & { getPath(name: 'userData'): string; getVersion(): string }
  ipc: { handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void }
  build: string
  setting: () => CrashReportsSetting
  openExternal: (url: string) => unknown
}): CrashReports {
  const userData = a.app.getPath('userData')
  const reports = createCrashReports({
    dir: path.join(userData, CRASH_DIR),
    env: nodeCrashEnv(a.app.getVersion(), a.build),
    setting: a.setting,
    openExternal: a.openExternal,
    // main's own file: the one the app writes from the main process (the Host client's side of the conversation)
    logPath: path.join(userData, 'host-client.log'),
    log: (m) => console.error(m)
  })
  registerCrashReports(a.proc, a.app, reports, (what) => lowerForOom(userData, what))
  a.ipc.handle('crash.report', (_e, payload) => reports.fromRenderer(payload))
  a.ipc.handle('crash.pending', () => reports.pending())
  a.ipc.handle('crash.send', (_e, id) => reports.send(id))
  return reports
}
