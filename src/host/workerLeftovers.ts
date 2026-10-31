// What a worker leaves running when its Dispatch ends (T16).
//
// The 25-agent memory measurement (knowledge/history/2026-10-31-memory-at-25-agents.md) found that the
// processes agents start and leave behind (node dev servers, Firefox, headless Chrome, bun) are the largest
// single block of memory on the machine: about 9 GB median and 14 GB at 25 agents. Ending a session does
// not end them: `taskkill /T` follows the parent chain, so a server started with `start`, `Start-Process`
// or `npm run dev &`, or whose intermediate parent already exited, is no longer in the tree it walks; on
// Linux only the child gets SIGTERM.
//
// So the Host **knows the tree while it is alive**: one process query per tick for every live worker
// session at once, and each descendant is remembered by pid **and** creation time, so a pid Windows hands
// to another process later is never taken for it. When the Dispatch has ended and its session is gone,
// the remembered processes still alive, and the orphans whose command line names the worker's worktree,
// are stopped. Never anything under a live pty or line process of this Host (the owner's tabs, other
// sessions), the Host itself or its ancestors (the app).
//
// The pure parts (parsing, the descendant walk, choosing what to stop, the activity line) are exported
// for tests; everything that touches a real process arrives as a dependency.
import { execFile, spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import type { OrchState } from '../core/orchestration/state'

/** How often the tracker looks at the live workers' process trees. One query covers all of them. */
export const LEFTOVER_TICK_MS = 45_000
/** After a session's pty ends, how long before the tracker looks again: the exit defer
 *  (`EXIT_DEFER_MS`, 3 s) for the Dispatch to close, plus time for the session's own tree kill. */
export const LEFTOVER_AFTER_EXIT_MS = 8_000
/** Linux: how long a SIGTERM gets before the SIGKILL. */
export const LINUX_TERM_GRACE_MS = 5_000

/** One process as the query sees it. `created` is comparable only within a platform: ms since the
 *  epoch on Windows, clock ticks since boot on Linux (`/proc/<pid>/stat` field 22). */
export interface ProcRow {
  pid: number
  ppid: number
  created: number
  /** The image name, such as `node.exe` or `firefox`. */
  name: string
  /** The command line, '' when it could not be read. */
  cmd: string
  /** Private bytes on Windows, resident bytes on Linux; 0 when unknown. */
  mem: number
}

/** A process by its identity: a pid alone can be reused, a pid with its creation time cannot. */
export interface ProcId {
  pid: number
  created: number
}

const isPid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

// ── Parsing ─────────────────────────────────────────────────────────────────────────────────────

/** One `Win32_Process` row as `queryWindowsProcesses` writes it (`p`, `pp`, `c`, `n`, `cl`, `m`), or
 *  null for a row that does not hold together. */
export function parseWindowsRow(o: unknown): ProcRow | null {
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  const pid = Number(r.p)
  const ppid = Number(r.pp)
  const created = Number(r.c)
  if (!isPid(pid) || !Number.isSafeInteger(ppid) || ppid < 0 || !Number.isSafeInteger(created) || created <= 0) return null
  const mem = Number(r.m)
  return {
    pid,
    ppid,
    created,
    name: typeof r.n === 'string' ? r.n : '',
    cmd: typeof r.cl === 'string' ? r.cl : '',
    mem: Number.isFinite(mem) && mem > 0 ? mem : 0
  }
}

/** The whole output of `queryWindowsProcesses`: one JSON array (PowerShell writes a lone object for a
 *  single row), or JSON lines. What does not parse is dropped. */
export function parseWindowsRows(out: string): ProcRow[] {
  const text = out.trim()
  if (!text) return []
  const rows: unknown[] = []
  try {
    const v: unknown = JSON.parse(text)
    if (Array.isArray(v)) rows.push(...v)
    else rows.push(v)
  } catch {
    for (const line of text.split(/\r?\n/)) {
      try {
        rows.push(JSON.parse(line))
      } catch {
        // a broken line is one process less, not a failed query
      }
    }
  }
  return rows.map(parseWindowsRow).filter((r): r is ProcRow => r !== null)
}

/** One Linux process from its `/proc/<pid>/stat` and `/proc/<pid>/cmdline`. The comm field is in
 *  parentheses and may hold spaces and parentheses itself, so the fields are counted from the last `)`. */
export function parseLinuxStat(stat: string, cmdline = '', pageSize = 4096): ProcRow | null {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const pid = Number(stat.slice(0, open).trim())
  const name = stat.slice(open + 1, close)
  // After ")": state(3) ppid(4) ... starttime(22) vsize(23) rss(24); index 0 here is field 3.
  const f = stat.slice(close + 1).trim().split(/\s+/)
  const ppid = Number(f[1])
  const created = Number(f[19])
  const rss = Number(f[21])
  if (!isPid(pid) || !Number.isSafeInteger(ppid) || ppid < 0 || !Number.isSafeInteger(created) || created < 0) return null
  return {
    pid,
    ppid,
    created,
    name,
    cmd: cmdline.replace(/\0+$/, '').split('\0').join(' '),
    mem: Number.isFinite(rss) && rss > 0 ? rss * pageSize : 0
  }
}

// ── The tree ────────────────────────────────────────────────────────────────────────────────────

/** The live process that is `row`'s parent: holds `row.ppid` and was made no later than `row`. A
 *  process holding that pid but made after `row` got the pid once the real parent was gone. */
function liveParent(byPid: Map<number, ProcRow>, row: ProcRow): ProcRow | null {
  const p = byPid.get(row.ppid)
  return p && p.pid !== row.pid && p.created <= row.created ? p : null
}

/**
 * Every descendant of `roots` in `rows`, the roots themselves left out. A root is a pid (looked up in
 * `rows`) or a pid with its creation time, which may be dead by now: its children still name it as their
 * parent on Windows. A child counts only when it was made no earlier than its parent, and a dead root's
 * child only when no live process holding that pid could be its parent instead, so a reused pid never
 * pulls in a stranger's tree.
 */
export function descendantsOf(rows: readonly ProcRow[], roots: ReadonlyArray<number | ProcId>): ProcRow[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const children = new Map<number, ProcRow[]>()
  for (const r of rows) {
    const list = children.get(r.ppid)
    if (list) list.push(r)
    else children.set(r.ppid, [r])
  }
  const out: ProcRow[] = []
  const seen = new Set<number>()
  const walk = (parent: ProcId): void => {
    for (const c of children.get(parent.pid) ?? []) {
      if (seen.has(c.pid) || c.created < parent.created) continue
      const live = liveParent(byPid, c)
      // The child's live parent is another process than `parent` (the pid changed hands).
      if (live && live.created !== parent.created) continue
      seen.add(c.pid)
      out.push(c)
      walk(c)
    }
  }
  for (const root of roots) {
    const id = typeof root === 'number' ? byPid.get(root) : root
    if (!id) continue
    seen.add(id.pid)
    walk(id)
  }
  return out
}

/** Whether `cmd` names `worktree` as a whole path (so `…\wt-a` does not match `…\wt-ab`). On Windows the
 *  compare ignores case and slash direction, and the Git Bash form `/c/…` counts too. */
export function namesWorktree(cmd: string, worktree: string, platform: NodeJS.Platform): boolean {
  const win = platform === 'win32'
  const norm = (s: string): string => (win ? s.replace(/\\/g, '/').toLowerCase() : s)
  const base = norm(worktree).replace(/\/+$/, '')
  if (base.length < 4) return false
  const forms = [base]
  const drive = win ? /^([a-z]):\/(.*)$/.exec(base) : null
  if (drive) forms.push(`/${drive[1]}/${drive[2]}`)
  const hay = norm(cmd)
  for (const form of forms) {
    for (let at = hay.indexOf(form); at >= 0; at = hay.indexOf(form, at + 1)) {
      const before = at === 0 ? '' : hay[at - 1]
      const after = hay[at + form.length] ?? ''
      // `/c/…` must not match inside `d:/c/…`; a path name goes on with a name character.
      if (form !== base && before !== '' && !/[\s"'=]/.test(before)) continue
      if (after === '' || !/[\w.\-]/.test(after)) return true
    }
  }
  return false
}

export interface StopGuard {
  /** Pids of every live pty and line process of this Host: they and their trees are the owner's tabs,
   *  other sessions and their children, and are never stopped. */
  liveRoots: readonly number[]
  /** The Host's own pid: it and its ancestors (the app) are never stopped. */
  hostPid: number
  /** A worktree-matched process must have been made at or after this (the Dispatch's start), in the
   *  platform's `created` unit. */
  since?: number
}

/**
 * What to stop for one ended Dispatch: the `remembered` descendants still alive (same pid **and**
 * creation time), the processes whose command line names `worktree` and whose parent is gone (a process
 * an editor or a service started for that folder has a live parent and is left alone), and the
 * descendants of both. Minus everything under `guard.liveRoots`, the Host and its ancestors.
 */
export function toStop(
  remembered: readonly ProcId[],
  nowRows: readonly ProcRow[],
  worktree: string | null,
  platform: NodeJS.Platform,
  guard: StopGuard
): ProcRow[] {
  const byPid = new Map(nowRows.map((r) => [r.pid, r]))
  const seeds = new Map<number, ProcRow>()
  for (const m of remembered) {
    const r = byPid.get(m.pid)
    if (r && r.created === m.created) seeds.set(r.pid, r)
  }
  if (worktree) {
    for (const r of nowRows) {
      if (seeds.has(r.pid) || !namesWorktree(r.cmd, worktree, platform)) continue
      if (guard.since !== undefined && r.created < guard.since) continue
      const parent = liveParent(byPid, r)
      // Linux hands an orphan to init (or a subreaper), so a parent there that is pid 1 counts as gone.
      const orphan = !parent || (platform !== 'win32' && (parent.pid === 1 || r.ppid <= 1))
      if (orphan) seeds.set(r.pid, r)
    }
  }
  const picked = new Map<number, ProcRow>(seeds)
  for (const d of descendantsOf(nowRows, [...remembered, ...seeds.values()])) picked.set(d.pid, d)
  if (picked.size === 0) return []

  const shielded = new Set<number>(guard.liveRoots)
  for (const d of descendantsOf(nowRows, guard.liveRoots)) shielded.add(d.pid)
  shielded.add(guard.hostPid)
  for (let r = byPid.get(guard.hostPid), hops = 0; r && hops < 64; hops++) {
    shielded.add(r.pid)
    r = liveParent(byPid, r) ?? undefined
  }
  return [...picked.values()].filter((r) => !shielded.has(r.pid) && r.pid > 4)
}

// ── The activity line ───────────────────────────────────────────────────────────────────────────

/** A short name for a stopped process: the image without `.exe`, and for a runtime (node, bun, deno)
 *  the package or script it runs, as in `node (storybook)`. */
export function procLabel(r: Pick<ProcRow, 'name' | 'cmd'>): string {
  const image = r.name.replace(/\.exe$/i, '') || 'process'
  if (!/^(node|bun|deno|npx|pnpm|yarn)$/i.test(image)) return image
  const cmd = r.cmd.replace(/\\/g, '/')
  const pkg = /node_modules\/(?:\.bin\/)?((?:@[^/\s"']+\/)?[^/\s"']+)/i.exec(cmd)
  if (pkg && !/^(npm|npx|corepack)$/i.test(pkg[1])) return `${image} (${pkg[1]})`
  const script = /\s"?([^\s"]*\/)?([^/\s"]+\.(?:m?js|cjs|ts))\b/i.exec(cmd)
  return script ? `${image} (${script[2]})` : image
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`
}

/** "Freed 3 processes worker X left running: node (storybook), firefox ×2, 4.1 GB". */
export function freedLine(worker: string, stopped: readonly ProcRow[]): string {
  const counts = new Map<string, number>()
  for (const r of stopped) counts.set(procLabel(r), (counts.get(procLabel(r)) ?? 0) + 1)
  const names = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
  const mem = stopped.reduce((sum, r) => sum + r.mem, 0)
  const what = stopped.length === 1 ? '1 process' : `${stopped.length} processes`
  return `Freed ${what} worker ${worker} left running: ${names.join(', ')}${mem > 0 ? `, ${formatBytes(mem)}` : ''}`
}

// ── The tracker ─────────────────────────────────────────────────────────────────────────────────

/** A worker Dispatch as the tracker needs it, read from orchestration state. */
export interface LeftoverDispatch {
  dispatchId: string
  sessionId: string
  /** The worker's own worktree, or null when it worked in a folder that is not one (a project root):
   *  the command-line match runs only over a worktree. */
  worktree: string | null
  /** When the Dispatch started, in the platform's `created` unit (see `StopGuard.since`). */
  since?: number
  /** Has it ended (an outcome or an end time)? */
  closed: boolean
  /** A Dispatch whose leftovers must stay: retained by the user, or abandoned (its resources may live on). */
  keep: boolean
  /** How the activity line names the worker. */
  label: string
}

export interface LeftoverTrackerDeps {
  platform: NodeJS.Platform
  hostPid: number
  /** The worker Dispatches worth looking at: every open one, and the ones that closed lately. */
  dispatches(): LeftoverDispatch[]
  /** The pid of the session's live pty, or null when it is not alive (ended, or never here). */
  sessionPid(sessionId: string): number | null
  /** The pids of every live pty and line process of this Host. */
  liveRoots(): number[]
  /** One query of every process on the machine. */
  list(): Promise<ProcRow[]>
  /** Stops these processes (the platform's way); a failure for one never stops the rest. */
  stop(rows: ProcRow[]): Promise<void>
  /** The activity line for a Dispatch that freed something. */
  freed(dispatchId: string, line: string): void
  log(m: string): void
  every?(ms: number, fn: () => void): () => void
  after?(ms: number, fn: () => void): () => void
  tickMs?: number
  afterExitMs?: number
}

export interface LeftoverTracker {
  /** One look: records the trees of the live workers, frees the Dispatches that ended. Never rejects. */
  tick(): Promise<void>
  /** A session's pty ended: look again once its Dispatch has had time to close. Never throws. */
  sessionEnded(sessionId: string): void
  /** Stops what this Dispatch's worker left running, now. Never rejects; runs at most once per Dispatch. */
  freeFor(dispatchId: string, rows?: ProcRow[]): Promise<number>
  /** What is remembered for a Dispatch (tests, logs). */
  rememberedOf(dispatchId: string): ProcId[]
  dispose(): void
}

interface Memory {
  sessionId: string
  procs: Map<number, ProcId>
  worktree: string | null
  since?: number
  label: string
}

export function createLeftoverTracker(d: LeftoverTrackerDeps): LeftoverTracker {
  const every =
    d.every ??
    ((ms: number, fn: () => void): (() => void) => {
      const t = setInterval(fn, ms)
      t.unref?.()
      return () => clearInterval(t)
    })
  const after =
    d.after ??
    ((ms: number, fn: () => void): (() => void) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return () => clearTimeout(t)
    })
  /** Per Dispatch, from the first tick that saw it open until it is freed. */
  const memory = new Map<string, Memory>()
  /** Dispatches already freed (or given up): never twice. Bounded by the Dispatches this Host has seen. */
  const done = new Set<string>()
  let running: Promise<void> | null = null
  let again = false
  let disposed = false
  let cancelAfter: (() => void) | null = null

  const memoryOf = (x: LeftoverDispatch): Memory => {
    let m = memory.get(x.dispatchId)
    if (!m) {
      m = { sessionId: x.sessionId, procs: new Map(), worktree: x.worktree, since: x.since, label: x.label }
      memory.set(x.dispatchId, m)
    }
    return m
  }

  const freeWith = async (dispatchId: string, rows?: ProcRow[]): Promise<number> => {
    const m = memory.get(dispatchId)
    if (!m || done.has(dispatchId)) return 0
    done.add(dispatchId)
    memory.delete(dispatchId)
    try {
      const now = rows ?? (await d.list())
      const stop = toStop([...m.procs.values()], now, m.worktree, d.platform, { liveRoots: d.liveRoots(), hostPid: d.hostPid, since: m.since })
      if (stop.length === 0) return 0
      await d.stop(stop)
      const line = freedLine(m.label, stop)
      d.log(`leftovers: dispatch ${dispatchId}: ${line} (${stop.map((r) => r.pid).join(', ')})`)
      try {
        d.freed(dispatchId, line)
      } catch (err) {
        d.log(`leftovers: the activity line for dispatch ${dispatchId} could not be written: ${String(err)}`)
      }
      return stop.length
    } catch (err) {
      d.log(`leftovers: freeing what dispatch ${dispatchId} left running failed: ${String(err)}`)
      return 0
    }
  }

  const look = async (): Promise<void> => {
    const all = d.dispatches()
    const live: Array<{ x: LeftoverDispatch; pid: number }> = []
    const due: LeftoverDispatch[] = []
    for (const x of all) {
      if (done.has(x.dispatchId)) continue
      if (x.keep) {
        // Retained or abandoned: what it runs is the person's to keep. Forgotten, never stopped.
        if (memory.delete(x.dispatchId) || x.closed) done.add(x.dispatchId)
        continue
      }
      const pid = d.sessionPid(x.sessionId)
      // The session is alive: its tree is remembered, whether or not the Dispatch has closed yet. A
      // closed Dispatch whose session lives on (worker_done before the release, or a session a later
      // Dispatch reuses) waits: the session's own MCP children are in that tree and are no leftovers.
      if (pid !== null) live.push({ x, pid })
      // Ended, and its session gone too. Only a Dispatch seen alive has a memory to free from.
      else if (x.closed && memory.has(x.dispatchId)) due.push(x)
    }
    if (live.length === 0 && due.length === 0) return
    const rows = await d.list()
    if (live.length > 0) {
      const byPid = new Map(rows.map((r) => [r.pid, r]))
      const parents = new Set(rows.map((r) => r.ppid))
      for (const { x, pid } of live) {
        const m = memoryOf(x)
        // A remembered process that is gone and left no child naming it can never matter again: a
        // worker runs thousands of short shells, and the memory must not grow with each.
        for (const [p, id] of m.procs) if (byPid.get(p)?.created !== id.created && !parents.has(p)) m.procs.delete(p)
        for (const r of descendantsOf(rows, [pid])) m.procs.set(r.pid, { pid: r.pid, created: r.created })
      }
    }
    for (const x of due) await freeWith(x.dispatchId, rows)
  }

  const tick = async (): Promise<void> => {
    if (disposed) return
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          again = false
          await look().catch((err) => d.log(`leftovers: look failed: ${String(err)}`))
        } while (again && !disposed)
      } finally {
        running = null
      }
    })()
    return running
  }

  const stopTicking = every(d.tickMs ?? LEFTOVER_TICK_MS, () => void tick())

  return {
    tick,
    sessionEnded: (sessionId) => {
      try {
        if (disposed) return
        // A session never tracked had no tree remembered; the next tick still sees its Dispatch.
        if (![...memory.values()].some((m) => m.sessionId === sessionId)) return
        cancelAfter?.()
        cancelAfter = after(d.afterExitMs ?? LEFTOVER_AFTER_EXIT_MS, () => {
          cancelAfter = null
          void tick()
        })
      } catch (err) {
        d.log(`leftovers: session ${sessionId} ended, and the look after it could not be planned: ${String(err)}`)
      }
    },
    freeFor: (dispatchId, rows) => freeWith(dispatchId, rows),
    rememberedOf: (dispatchId) => [...(memory.get(dispatchId)?.procs.values() ?? [])],
    dispose: () => {
      disposed = true
      stopTicking()
      cancelAfter?.()
    }
  }
}

// ── The real machine ────────────────────────────────────────────────────────────────────────────

type Exec = (file: string, args: string[]) => Promise<string>

const defaultExec: Exec = (file, args) =>
  new Promise((resolve, reject) => {
    // Every command line on the machine can run past the 1 MB default.
    execFile(file, args, { windowsHide: true, timeout: 60_000, maxBuffer: 64 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })

/** Every process on a Windows machine, from **one** hidden Windows PowerShell and one CIM query (the
 *  pattern of `reapWindowsConsoleHosts`). Creation time in ms since the epoch, private bytes as `m`. */
export async function queryWindowsProcesses(exec: Exec = defaultExec): Promise<ProcRow[]> {
  const script =
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
    'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { ' +
    '[pscustomobject]@{ p = $_.ProcessId; pp = $_.ParentProcessId; c = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); ' +
    'n = $_.Name; cl = $_.CommandLine; m = $_.PrivatePageCount } })'
  return parseWindowsRows(await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]))
}

/** Every process on a Linux machine, from `/proc/<pid>/stat` and `cmdline`. A process that ends while
 *  it is read is skipped. */
export async function readLinuxProcesses(fs: { readdir(p: string): Promise<string[]>; readFile(p: string): Promise<string> } = {
  readdir: (p) => readdir(p),
  readFile: (p) => readFile(p, 'utf8')
}): Promise<ProcRow[]> {
  const rows: ProcRow[] = []
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = await fs.readFile(`/proc/${entry}/stat`)
      const cmd = await fs.readFile(`/proc/${entry}/cmdline`).catch(() => '')
      const row = parseLinuxStat(stat, cmd)
      if (row) rows.push(row)
    } catch {
      // gone between the listing and the read
    }
  }
  return rows
}

/** Stops `rows` the platform's way. Windows: `taskkill /pid <p> /T /F`, hidden, one per process (a
 *  process its parent's `/T` already took answers "not found", which is fine). Linux: SIGTERM, then after
 *  the grace SIGKILL to each one still holding its pid **with the same start time**. */
export async function stopProcesses(
  rows: readonly ProcRow[],
  o: {
    platform: NodeJS.Platform
    log(m: string): void
    taskkill?(pid: number): Promise<void>
    signal?(pid: number, sig: NodeJS.Signals): void
    startTimeOf?(pid: number): Promise<number | null>
    wait?(ms: number): Promise<void>
  }
): Promise<void> {
  if (o.platform === 'win32') {
    const taskkill =
      o.taskkill ??
      ((pid: number) =>
        new Promise<void>((resolve) => {
          const p = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          p.on('error', () => resolve())
          p.on('exit', () => resolve())
        }))
    for (const r of rows) await taskkill(r.pid).catch((err: unknown) => o.log(`leftovers: taskkill ${r.pid} failed: ${String(err)}`))
    return
  }
  const signal = o.signal ?? ((pid: number, sig: NodeJS.Signals) => process.kill(pid, sig))
  const startTimeOf =
    o.startTimeOf ??
    (async (pid: number) => {
      const row = parseLinuxStat(await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => ''))
      return row ? row.created : null
    })
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const sent: ProcRow[] = []
  for (const r of rows) {
    try {
      signal(r.pid, 'SIGTERM')
      sent.push(r)
    } catch {
      // already gone
    }
  }
  if (sent.length === 0) return
  await wait(LINUX_TERM_GRACE_MS)
  for (const r of sent) {
    if ((await startTimeOf(r.pid).catch(() => null)) !== r.created) continue
    try {
      signal(r.pid, 'SIGKILL')
    } catch {
      // ended in between
    }
  }
}

// ── From orchestration state ────────────────────────────────────────────────────────────────────

/** How long after its end a Dispatch is still handed to the tracker. A Dispatch ends before its session
 *  does (worker_done, then the release), and a release can wait on a retain or a reuse. */
export const LEFTOVER_RECENT_MS = 24 * 60 * 60 * 1000

/** The Dispatches the tracker looks at: every open one and every one that ended in the last
 *  `LEFTOVER_RECENT_MS`. `isWorktree` says whether a folder is one of the Host's worktrees: only then
 *  is a worker's `cwd` matched against command lines (a project root is the owner's too). */
export function leftoverDispatchesOf(
  s: Pick<OrchState, 'dispatches' | 'tasks'>,
  now: number,
  platform: NodeJS.Platform,
  isWorktree: (p: string) => boolean
): LeftoverDispatch[] {
  const out: LeftoverDispatch[] = []
  for (const x of s.dispatches) {
    const closed = Boolean(x.outcome || x.endedAt)
    const endedAt = Date.parse(x.endedAt ?? x.startedAt)
    if (closed && Number.isFinite(endedAt) && now - endedAt > LEFTOVER_RECENT_MS) continue
    const startedAt = Date.parse(x.startedAt)
    const task = s.tasks.find((t) => t.id === x.taskId)
    out.push({
      dispatchId: x.id,
      sessionId: x.sessionId,
      worktree: x.cwd && isWorktree(x.cwd) ? x.cwd : null,
      // Linux counts creation in clock ticks since boot, which an ISO time does not compare with.
      ...(platform === 'win32' && Number.isFinite(startedAt) ? { since: startedAt } : {}),
      closed,
      keep: x.retained || x.closedBy === 'abandon',
      label: task ? `"${task.title}"` : x.id
    })
  }
  return out
}
