// Windows diagnostic (setting `windowDiagnostic`, off by default): which processes the Host started show a window.
//
// Every 15 s one hidden PowerShell query lists the process table with a flag for "owns a visible window"; the
// Host's descendants (walked through the parent pid) that have one are logged once each, with their command line.
// Every 10 minutes a summary line says how many were seen, so a run of 3 plans can be checked for zero from the log.
// The query, the parse and the dedupe are pure; the spawn, the clock and the setting arrive as dependencies.
import { execFile } from 'node:child_process'

export const WINDOW_DIAGNOSTIC_EVERY_MS = 15_000
export const WINDOW_DIAGNOSTIC_SUMMARY_MS = 10 * 60_000
/** The environment variable that carries the Host pid to the script: never a pid on the command line. */
export const WINDOW_DIAGNOSTIC_ENV = 'ASTERA_WINDOW_DIAGNOSTIC_HOST_PID'
const CMD_MAX = 500

export interface ProcessRow {
  pid: number
  parent: number
  name: string
  cmd: string
  /** ms since the epoch: with the pid it names one process, as Windows reuses pids. */
  created: number
  window: boolean
}

// A fixed script. It keeps the Host's descendants (the pid comes from the environment), and reads a command line
// only for a process that has a window, so the output stays small.
const SCRIPT =
  `$root=[int]$env:${WINDOW_DIAGNOSTIC_ENV}; $w=@{}; ` +
  `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $w[[int]$_.Id]=$true }; ` +
  `$all=@(Get-CimInstance Win32_Process); $keep=@{}; $keep[$root]=$true; ` +
  `do { $n=0; foreach ($p in $all) { if (-not $keep[[int]$p.ProcessId] -and $keep[[int]$p.ParentProcessId]) { $keep[[int]$p.ProcessId]=$true; $n++ } } } while ($n -gt 0); ` +
  `ConvertTo-Json -Compress -InputObject @($all | Where-Object { $keep[[int]$_.ProcessId] } | ForEach-Object { ` +
  `$win=[bool]$w[[int]$_.ProcessId]; ` +
  `@{ ProcessId=[int]$_.ProcessId; ParentProcessId=[int]$_.ParentProcessId; Name=$_.Name; ` +
  `CommandLine=$(if($win){$_.CommandLine}else{''}); ` +
  `Created=$(if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{0}); HasWindow=$win } })`

type Exec = (file: string, args: string[], opts: { env: Record<string, string | undefined>; windowsHide: boolean }) => Promise<string>

const defaultExec: Exec = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: opts.env, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })

/** The process table as JSON text, through Windows PowerShell. The Host pid goes in the environment. */
export async function queryWindowTable(hostPid: number, exec: Exec = defaultExec): Promise<string> {
  if (!Number.isSafeInteger(hostPid) || hostPid <= 0) throw new Error(`not a pid: ${hostPid}`)
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
    env: { ...process.env, [WINDOW_DIAGNOSTIC_ENV]: String(hostPid) },
    windowsHide: true
  })
}

/** Reads the query's JSON (an array, or a lone object when there is one row). Anything unreadable is an empty table. */
export function parseProcessTable(text: string): ProcessRow[] {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return []
  }
  const rows: ProcessRow[] = []
  for (const r of Array.isArray(v) ? v : [v]) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (typeof o.ProcessId !== 'number' || !Number.isSafeInteger(o.ProcessId) || o.ProcessId <= 0) continue
    rows.push({
      pid: o.ProcessId,
      parent: typeof o.ParentProcessId === 'number' ? o.ParentProcessId : 0,
      name: typeof o.Name === 'string' ? o.Name : '',
      cmd: typeof o.CommandLine === 'string' ? o.CommandLine : '',
      created: typeof o.Created === 'number' ? o.Created : 0,
      window: o.HasWindow === true
    })
  }
  return rows
}

/** Every process below `root` (children, their children…), not `root` itself. */
export function descendantsOf(table: ProcessRow[], root: number): ProcessRow[] {
  const seen = new Set<number>([root])
  const out: ProcessRow[] = []
  for (let grew = true; grew; ) {
    grew = false
    for (const p of table) {
      if (seen.has(p.pid) || !seen.has(p.parent)) continue
      seen.add(p.pid)
      out.push(p)
      grew = true
    }
  }
  return out
}

export interface WindowDiagnostic {
  /** Starts the timer; nothing off win32. The setting is read at every tick, so turning it on or off needs no restart. */
  start(): void
  stop(): void
  /** One pass. Never rejects. */
  tick(): Promise<void>
}

export function createWindowDiagnostic(d: {
  platform: NodeJS.Platform
  hostPid: number
  enabled(): Promise<boolean>
  query(hostPid: number): Promise<string>
  log(m: string): void
  now?(): number
}): WindowDiagnostic {
  const now = d.now ?? Date.now
  const logged = new Set<string>()
  let seenInWindow = 0
  let summaryAt = now()
  let timer: NodeJS.Timeout | null = null
  let busy = false

  const tick = async (): Promise<void> => {
    if (d.platform !== 'win32' || busy) return
    busy = true
    try {
      if (!(await d.enabled())) return
      const table = parseProcessTable(await d.query(d.hostPid))
      for (const p of descendantsOf(table, d.hostPid)) {
        const key = `${p.pid}:${p.created}`
        if (!p.window || logged.has(key)) continue
        logged.add(key)
        seenInWindow++
        d.log(`visible window: pid=${p.pid} image=${p.name} parent=${p.parent} cmd=${p.cmd.slice(0, CMD_MAX)}`)
      }
      if (now() - summaryAt >= WINDOW_DIAGNOSTIC_SUMMARY_MS) {
        d.log(`window diagnostic: ${seenInWindow} visible windows seen in the last 10 min`)
        seenInWindow = 0
        summaryAt = now()
      }
    } catch (err) {
      d.log(`window diagnostic: the query failed: ${String(err)}`)
    } finally {
      busy = false
    }
  }

  return {
    start: () => {
      if (d.platform !== 'win32' || timer) return
      summaryAt = now()
      timer = setInterval(() => void tick(), WINDOW_DIAGNOSTIC_EVERY_MS)
      timer.unref?.()
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    },
    tick
  }
}
