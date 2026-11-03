// Windows diagnostic (setting `windowDiagnostic`, off by default): which windows pop up while Astera works.
//
// **Why a watcher and not a poll.** The first version listed the Host's descendants with a visible window every 15 s.
// It logged "0 visible windows" while the owner watched console windows flash up: those windows live for well under a
// second (a hook, a `git` or an `npx` that exits at once), so a 15 s sample almost never lands on one. And on Windows 11
// the default terminal is Windows Terminal: a console program that is given a NEW visible console is handed off to it,
// so the window belongs to WindowsTerminal.exe (started through COM, with OpenConsole.exe -Embedding), never to a
// descendant of the Host. A descendant walk cannot see that window at all.
//
// So, while the setting is on, one hidden PowerShell runs for the Host's whole life and enumerates the desktop's
// top-level windows every 100 ms. It prints one JSON line per window that becomes visible, with the owning process and
// its parent chain (read when the window appears, while the process still exists), and a second line with the window's
// title a second later (a Windows Terminal tab is titled after the program it shows, but only once that program ran).
// The Host logs a window when its chain reaches the Host, and any console or terminal window whatever its owner (a
// handed-off console carries no Host in its chain; its title names the program). Every 10 minutes a summary line says
// how many were seen, so a run of plans can be checked for zero from the log. The script exits on its own when the
// Host is gone. Parsing, classifying and the summary are pure; the spawn, the clock and the setting are dependencies.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/** How often the setting is read (the watcher starts or stops to match) and the summary is checked. */
export const WINDOW_DIAGNOSTIC_EVERY_MS = 15_000
export const WINDOW_DIAGNOSTIC_SUMMARY_MS = 10 * 60_000
/** The environment variable that carries the Host pid to the script: never a pid on the command line. */
export const WINDOW_DIAGNOSTIC_ENV = 'ASTERA_WINDOW_DIAGNOSTIC_HOST_PID'
const TEXT_MAX = 500

/** Window classes of a console: classic conhost, Windows Terminal (a handed-off console), and ConPTY's own. */
export const CONSOLE_WINDOW_CLASSES = ['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow'] as const

export interface ChainLink {
  pid: number
  name: string
}

/** One window that became visible. `chain` starts at the owning process and walks up its parents. */
export interface WindowShown {
  kind: 'shown'
  hwnd: number
  pid: number
  cls: string
  title: string
  /** The owner's command line, read when the window appeared. */
  cmd: string
  chain: ChainLink[]
}

/** The same window's title a second after it appeared. */
export interface WindowTitled {
  kind: 'title'
  hwnd: number
  title: string
}

export type WindowEvent = WindowShown | WindowTitled

// A fixed script. The window loop is C# (EnumWindows through P/Invoke, compiled once by Add-Type); the parent chain is
// read through CIM only for a window that just appeared, which is rare, so the loop itself costs next to nothing.
// Windows already visible when it starts are the baseline and are not reported.
const SCRIPT = [
  `$ErrorActionPreference='SilentlyContinue'; $root=[int]$env:${WINDOW_DIAGNOSTIC_ENV};`,
  `Add-Type -TypeDefinition 'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;`,
  `public static class AsteraWinDiag { public delegate bool P(IntPtr h, IntPtr l);`,
  `[DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l); [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);`,
  `[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);`,
  `[DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);`,
  `[DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);`,
  `public static string Title(long h) { var t = new StringBuilder(512); GetWindowText(new IntPtr(h), t, 512); return t.ToString(); }`,
  `public static List<object[]> Visible() { var r = new List<object[]>(); EnumWindows((h, l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p);`,
  `var c = new StringBuilder(256); GetClassName(h, c, 256); r.Add(new object[] { h.ToInt64(), (long)p, c.ToString() }); } return true; }, IntPtr.Zero); return r; } }';`,
  `$seen=@{}; foreach ($w in [AsteraWinDiag]::Visible()) { $seen[$w[0]]=$true };`,
  `$late=@{}; $n=0;`,
  `while ($true) {`,
  `  foreach ($w in [AsteraWinDiag]::Visible()) { $h=$w[0]; if ($seen[$h]) { continue }; $seen[$h]=$true; $p=[int]$w[1];`,
  `    $chain=@(); $cmd=''; $q=$p; for ($i=0; $i -lt 12 -and $q -gt 0; $i++) { $c=Get-CimInstance Win32_Process -Filter "ProcessId=$q"; if (-not $c) { break };`,
  `      if ($i -eq 0) { $cmd=[string]$c.CommandLine }; $chain+=@{ pid=[int]$q; name=[string]$c.Name }; if ($q -eq $root) { break }; $q=[int]$c.ParentProcessId }`,
  `    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject @{ kind='shown'; hwnd=$h; pid=$p; cls=$w[2]; title=[AsteraWinDiag]::Title($h); cmd=$cmd; chain=@($chain) }));`,
  `    $late[$h]=(Get-Date).AddSeconds(1) }`,
  `  foreach ($h in @($late.Keys)) { if ((Get-Date) -ge $late[$h]) { $late.Remove($h);`,
  `    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ kind='title'; hwnd=$h; title=[AsteraWinDiag]::Title($h) })) } }`,
  `  [Console]::Out.Flush(); $n++;`,
  `  if ($n % 20 -eq 0 -and -not (Get-Process -Id $root)) { exit 0 }`,
  `  Start-Sleep -Milliseconds 100 }`
].join('\n')

/** The script as `-EncodedCommand` takes it: base64 of its UTF-16LE text. */
export const encodedScript = (): string => Buffer.from(SCRIPT, 'utf16le').toString('base64')

/** A running watcher. */
export interface WindowWatch {
  stop(): void
}

export type Watch = (hostPid: number, onLine: (line: string) => void, onExit: (why: string) => void) => WindowWatch

/** The watcher as a hidden PowerShell child; one line of its stdout per event. The Host pid goes in the environment. */
export const watchWindows: Watch = (hostPid, onLine, onExit) => {
  if (!Number.isSafeInteger(hostPid) || hostPid <= 0) throw new Error(`not a pid: ${hostPid}`)
  // -EncodedCommand: the script holds double quotes (C# string literals), which Windows PowerShell's own command-line
  // parsing would mangle in a plain -Command argument.
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript()], {
    env: { ...process.env, [WINDOW_DIAGNOSTIC_ENV]: String(hostPid) },
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  })
  let stopped = false
  createInterface({ input: child.stdout }).on('line', onLine)
  child.once('error', (err) => {
    if (!stopped) onExit(String(err))
  })
  child.once('exit', (code) => {
    if (!stopped) onExit(`it exited with ${code}`)
  })
  return {
    stop: () => {
      stopped = true
      child.kill()
    }
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One line of the watcher's output. Anything unreadable is null. */
export function parseWindowEvent(line: string): WindowEvent | null {
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const hwnd = num(o.hwnd)
  if (hwnd === null) return null
  if (o.kind === 'title') return { kind: 'title', hwnd, title: str(o.title) }
  if (o.kind !== 'shown') return null
  const pid = num(o.pid)
  if (pid === null) return null
  const chain: ChainLink[] = []
  // ConvertTo-Json writes a one-element array as the element itself.
  const raw = Array.isArray(o.chain) ? o.chain : o.chain && typeof o.chain === 'object' ? [o.chain] : []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) continue
    const p = num((l as Record<string, unknown>).pid)
    if (p !== null) chain.push({ pid: p, name: str((l as Record<string, unknown>).name) })
  }
  return { kind: 'shown', hwnd, pid, cls: str(o.cls), title: str(o.title), cmd: str(o.cmd), chain }
}

/** Why a window is worth a log line: started under the Host, a console or terminal window, or neither. */
export function classifyWindow(e: WindowShown, hostPid: number): 'host' | 'console' | null {
  if (e.chain.some((l) => l.pid === hostPid)) return 'host'
  if ((CONSOLE_WINDOW_CLASSES as readonly string[]).includes(e.cls)) return 'console'
  return null
}

const cut = (s: string): string => s.replace(/\s+/g, ' ').slice(0, TEXT_MAX)

export function describeWindow(e: WindowShown, why: 'host' | 'console'): string {
  const chain = e.chain.map((l) => `${l.name}(${l.pid})`).join(' <- ')
  const head = why === 'host' ? 'visible window (Host child)' : 'visible console window'
  return `${head}: hwnd=${e.hwnd} pid=${e.pid} class=${e.cls} title=${JSON.stringify(cut(e.title))} chain=${chain || '?'} cmd=${cut(e.cmd)}`
}

export interface WindowDiagnostic {
  /** Starts the timer; nothing off win32. The setting is read at every tick, so turning it on or off needs no restart. */
  start(): void
  stop(): void
  /** One pass: start or stop the watcher to match the setting, and write the summary when it is due. Never rejects. */
  tick(): Promise<void>
}

export function createWindowDiagnostic(d: {
  platform: NodeJS.Platform
  hostPid: number
  enabled(): Promise<boolean>
  watch: Watch
  log(m: string): void
  now?(): number
}): WindowDiagnostic {
  const now = d.now ?? Date.now
  /** Windows logged, by handle: their late title is logged when it says more than the first one did. */
  const logged = new Map<number, string>()
  let seenInWindow = 0
  let summaryAt = now()
  let timer: NodeJS.Timeout | null = null
  let watch: WindowWatch | null = null
  let busy = false

  const onLine = (line: string): void => {
    const e = parseWindowEvent(line)
    if (!e) return
    if (e.kind === 'title') {
      const first = logged.get(e.hwnd)
      logged.delete(e.hwnd)
      if (first !== undefined && e.title && e.title !== first) d.log(`visible window title: hwnd=${e.hwnd} title=${JSON.stringify(cut(e.title))}`)
      return
    }
    const why = classifyWindow(e, d.hostPid)
    if (!why) return
    seenInWindow++
    logged.set(e.hwnd, e.title)
    if (logged.size > 1000) logged.clear()
    d.log(describeWindow(e, why))
  }

  const stopWatch = (): void => {
    watch?.stop()
    watch = null
  }

  const tick = async (): Promise<void> => {
    if (d.platform !== 'win32' || busy) return
    busy = true
    try {
      if (!(await d.enabled())) {
        if (watch) d.log('window diagnostic: off')
        stopWatch()
        summaryAt = now()
        seenInWindow = 0
        return
      }
      if (!watch) {
        summaryAt = now()
        seenInWindow = 0
        const w = d.watch(d.hostPid, onLine, (why) => {
          if (watch !== w) return
          watch = null
          d.log(`window diagnostic: the watcher stopped (${why}); it restarts at the next check`)
        })
        watch = w
        d.log('window diagnostic: watching for windows that appear')
      }
      if (now() - summaryAt >= WINDOW_DIAGNOSTIC_SUMMARY_MS) {
        d.log(`window diagnostic: ${seenInWindow} visible windows seen in the last 10 min`)
        seenInWindow = 0
        summaryAt = now()
      }
    } catch (err) {
      d.log(`window diagnostic: the watcher failed: ${String(err)}`)
    } finally {
      busy = false
    }
  }

  return {
    start: () => {
      if (d.platform !== 'win32' || timer) return
      summaryAt = now()
      void tick()
      timer = setInterval(() => void tick(), WINDOW_DIAGNOSTIC_EVERY_MS)
      timer.unref?.()
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
      stopWatch()
    },
    tick
  }
}
