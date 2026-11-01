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
import fsSync from 'node:fs'
import path from 'node:path'
import v8 from 'node:v8'
import type { HostLog } from './log'

export const EXIT_RECORD = 'exit-record.json'
/** Shares of V8's heap limit that are logged, once each. */
export const HEAP_THRESHOLDS: readonly number[] = [0.8, 0.95]
export const WATCH_EVERY_MS = 10_000

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

/** What the last Host left in `dir`, as host.log lines (none for a profile that never had one). Never throws. */
export function previousHostLines(dir: string, o: { fs?: ExitFs } = {}): string[] {
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
    dispose: () => clearInterval(timer)
  }
}
