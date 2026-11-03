// Why the Host ended (owner item 25a). 2026-11-01 12:06:37 UTC: a Host died with 15 agents running and no line, no
// stderr and no Windows event, and neither handler in log.ts had fired. It was process.exit from somewhere, a V8
// out-of-memory abort, a native crash in node-pty, or a kill from outside. This leaves a trace for each:
//
//  - the `exit` event writes one synchronous host.log line: the code, the uptime, the last command;
//  - a heap watch logs once when used heap crosses 80% and 95% of V8's limit, flushed at once, because an
//    out-of-memory abort gives no exit event;
//  - `exit-record.json` in the Host folder holds the commands running now (name and start, never arguments, which can
//    carry a secret), written synchronously when one starts and ends, and stamped by the heap timer every 10 s. It
//    also gets the exit code on the way out. The next Host reads it (`previousHostLines`): an exit code says how the
//    last one left, none says it was killed from outside or crashed natively, and a command still running says what
//    it was doing and for how long (up to its last stamp).
//  - a forced end by the app (an unanswering Host replaced with taskkill) leaves the app's note `ended-by-app.json`
//    (core/host/endedByApp.ts), so that end is named as the app's and not read as a native crash.
import fsSync from 'node:fs'
import path from 'node:path'
import v8 from 'node:v8'
import type { HostLog } from './log'
import { ENDED_BY_APP, parseEndedByApp, type EndedByApp } from '../core/host/endedByApp'

export const EXIT_RECORD = 'exit-record.json'
/** Shares of V8's heap limit that are logged, once each. */
export const HEAP_THRESHOLDS: readonly number[] = [0.8, 0.95]
export const WATCH_EVERY_MS = 10_000
/** How often `seen` is stamped. A record older than 3 of these, with no exit and a dead pid, is a Host that died silently. */
export const HEARTBEAT_MS = 3_000
export const TAIL_LINES = 20
const TAIL_BYTES = 64 * 1024

interface Running {
  cmd: string
  at: number
}
interface Crumb {
  pid: number
  startedAt: number
  /** The last time this Host was seen alive: a command start or end, or the timer. */
  seen: number
  running: Running[]
  last?: string
  exit?: { code: number; at: number }
}

export interface ExitFs {
  writeFileSync(p: string, data: string): void
  readFileSync(p: string, enc: 'utf8'): string
  mkdirSync(p: string, o: { recursive: true }): unknown
}

export interface ExitWatch {
  /** Runs `run` with `cmd` kept as the breadcrumb for as long as it takes. Only the name: never the arguments. */
  command<T>(cmd: string, run: () => Promise<T>): Promise<T>
  dispose(): void
}

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000))
const mb = (n: number): number => Math.round(n / (1024 * 1024))

/** The last `n` lines of a log, read from a bounded tail of the file, never the whole of it. Never throws. */
export function readLogTail(file: string, n = TAIL_LINES): string[] {
  try {
    const fd = fsSync.openSync(file, 'r')
    try {
      const size = fsSync.fstatSync(fd).size
      const len = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(len)
      fsSync.readSync(fd, buf, 0, len, size - len)
      const lines = buf.toString('utf8').split(String.fromCharCode(10)).map((l) => l.trimEnd()).filter((l) => l !== '')
      if (size > len) lines.shift() // the first line of a mid-file window is cut
      return lines.slice(-n)
    } finally {
      fsSync.closeSync(fd)
    }
  } catch {
    return []
  }
}

/** Is `pid` a running process? EPERM means it exists but is not ours: alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The app's note that it ended Host `pid` (core/host/endedByApp.ts), when there is one for that Host: the same pid,
 *  written after that Host started (a pid is reused, so an older note names another process). Never throws. */
function endedByAppOf(dir: string, fs: ExitFs, pid: number, startedAt: number | undefined): EndedByApp | null {
  try {
    const note = parseEndedByApp(fs.readFileSync(path.join(dir, ENDED_BY_APP), 'utf8'))
    if (!note || note.pid !== pid) return null
    return typeof startedAt === 'number' && note.at < startedAt ? null : note
  } catch {
    return null
  }
}

/** What the last Host left in `dir`, as host.log lines (none for a profile that never had one). Never throws.
 *  `tail` is the previous host.log's last lines, read before this Host wrote its own first line. */
export function previousHostLines(
  dir: string,
  o: { fs?: ExitFs; now?: () => number; alive?: (pid: number) => boolean; tail?: string[] } = {}
): string[] {
  const fs = o.fs ?? fsSync
  let raw: string
  try {
    raw = fs.readFileSync(path.join(dir, EXIT_RECORD), 'utf8')
  } catch {
    return [] // first start here, or a Host from before this record
  }
  try {
    const r = JSON.parse(raw) as Partial<Crumb>
    const up = typeof r.startedAt === 'number' && typeof r.seen === 'number' ? ` after ${seconds(r.seen - r.startedAt)} s` : ''
    const pid = typeof r.pid === 'number' ? ` (pid ${r.pid})` : ''
    const doing = (r.running ?? []).slice(0, 3).map((c) => `${c.cmd} for ${seconds((r.seen ?? c.at) - c.at)} s`)
    const lines: string[] = []
    const silent = !r.exit && typeof r.seen === 'number' && (o.now ?? Date.now)() - r.seen > 3 * HEARTBEAT_MS
    const alive = typeof r.pid === 'number' ? (o.alive ?? pidAlive)(r.pid) : false
    if (!r.exit && alive) return [] // a live pid is a Host still running, not a dead one
    // The app ended this very Host by force (core/host/endedByApp.ts): no exit handler ran, and that is why, not a crash.
    const ended = !r.exit && typeof r.pid === 'number' ? endedByAppOf(dir, fs, r.pid, r.startedAt) : null
    if (ended) {
      lines.push(`the last Host${pid} was ended by the app (${ended.why})${up}; last heartbeat ${new Date((r.seen ?? ended.at) as number).toISOString()}`)
      if (doing.length > 0) lines.push(`the last Host was running ${doing.join(', ')} when it was ended`)
      for (const l of (o.tail ?? []).slice(-TAIL_LINES)) lines.push(`  | ${l}`)
      return lines
    }
    if (silent) {
      lines.push(`the last Host${pid} died without a word (native crash?)${up}; last heartbeat ${new Date(r.seen as number).toISOString()}`)
      if (doing.length > 0) lines.push(`the last Host died while running ${doing.join(', ')}`)
      for (const l of (o.tail ?? []).slice(-TAIL_LINES)) lines.push(`  | ${l}`)
      return lines
    }
    if (r.exit && typeof r.exit.code === 'number') lines.push(`the last Host${pid} exited with code ${r.exit.code}${up}${r.last ? `; its last command was ${r.last}` : ''}`)
    else lines.push(`the last Host${pid} left no exit record: killed from outside or a native crash${up}`)
    if (doing.length > 0) lines.push(`the last Host ${r.exit ? 'left' : 'died'} while running ${doing.join(', ')}`)
    return lines
  } catch {
    return ['the last Host left no readable exit record: killed from outside or a native crash']
  }
}

export function watchExit(a: {
  proc: { on(event: 'exit', l: (code: number) => void): unknown }
  log: HostLog
  /** The Host folder, `<profile>/host`. */
  dir: string
  fs?: ExitFs
  now?: () => number
  heap?: () => { used: number; limit: number }
  every?: number
  heartbeat?: number
  pid?: number
}): ExitWatch {
  const fs = a.fs ?? fsSync
  const now = a.now ?? Date.now
  const heap = a.heap ?? ((): { used: number; limit: number } => {
    const s = v8.getHeapStatistics()
    return { used: s.used_heap_size, limit: s.heap_size_limit }
  })
  const file = path.join(a.dir, EXIT_RECORD)
  const rec: Crumb = { pid: a.pid ?? process.pid, startedAt: now(), seen: now(), running: [] }
  const live = new Map<number, Running>()
  let seq = 0

  const persist = (): void => {
    try {
      rec.seen = now()
      rec.running = [...live.values()]
      fs.mkdirSync(a.dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(rec))
    } catch {
      /* a record that cannot be written costs the record, never a command */
    }
  }

  a.proc.on('exit', (code) => {
    try {
      rec.exit = { code, at: now() }
      persist()
      const doing = [...live.values()].map((c) => `${c.cmd} for ${seconds(now() - c.at)} s`)
      a.log.write(
        `exit: code ${code} after ${seconds(now() - rec.startedAt)} s; last command: ${rec.last ?? 'none'}${doing.length > 0 ? `; still running: ${doing.slice(0, 3).join(', ')}` : ''}`
      )
      a.log.close()
    } catch {
      /* nowhere left to say it */
    }
  })

  const said = new Set<number>()
  const tick = (): void => {
    try {
      const { used, limit } = heap()
      const crossed = HEAP_THRESHOLDS.filter((t) => limit > 0 && used / limit >= t && !said.has(t))
      if (crossed.length > 0) {
        for (const t of crossed) said.add(t)
        // The highest only: a jump past both is one line. Flushed now, an out-of-memory abort never reaches `exit`.
        a.log.write(`heap: ${Math.round((used / limit) * 100)}% of the V8 limit (${mb(used)} of ${mb(limit)} MB, past ${Math.max(...crossed) * 100}%)`)
        a.log.close()
      }
      persist()
    } catch {
      /* the watch is not worth a Host */
    }
  }
  const timer = setInterval(tick, a.every ?? WATCH_EVERY_MS)
  timer.unref()
  const beat = setInterval(persist, a.heartbeat ?? HEARTBEAT_MS) // persist never throws
  beat.unref()
  persist()

  return {
    async command(cmd, run) {
      const id = ++seq
      live.set(id, { cmd, at: now() })
      rec.last = cmd
      persist()
      try {
        return await run()
      } finally {
        live.delete(id)
        persist()
      }
    },
    dispose: () => {
      clearInterval(timer)
      clearInterval(beat)
    }
  }
}
