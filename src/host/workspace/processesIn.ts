// The processes still running in a folder about to be removed (T22). A worker's `go run` server, started with
// the worktree as its cwd, outlived the worker, locked the folder and left it half removed. So before a worktree
// goes, what still names it on its command line or executable path, and what was recorded under a session that ran
// there, is stopped, with everything it started. Never the Host, its ancestors (the app), or anything under a live pty
// or line process of this Host: those are the owner's tabs and the sessions still at work.
//
// The choosing is workerLeftovers.ts' `toStop`, the stopping its `stopProcesses`: one rule for what a worker left.
import { namesWorktree, queryWindowsProcesses, readLinuxProcesses, stopProcesses, toStop, type ProcId, type ProcRow } from '../workerLeftovers'

export interface StopInDeps {
  platform: NodeJS.Platform
  hostPid: number
  /** The pids of every live pty and line process of this Host. Throws when they cannot be read: nothing is stopped then. */
  liveRoots(): number[]
  /** One query of every process on the machine. */
  list(): Promise<ProcRow[]>
  stop(rows: ProcRow[]): Promise<void>
  /** What was recorded (pid and creation time) under the sessions that ran in `dir`: found even when nothing on
   *  its command line names the folder (Windows cannot read another process's cwd). */
  remembered?(dir: string): ProcId[]
  log(m: string): void
}

/** Stops what still runs in `dir`, and answers what it stopped. One log line when it stopped anything. Never
 *  rejects: a removal goes on without it, and fails on its own if the folder is still held. */
export async function stopProcessesIn(dir: string, d: StopInDeps): Promise<ProcRow[]> {
  try {
    const rows = await d.list()
    // The Host and its ancestors (the app, a dev Electron started from that folder) are no seeds: `toStop` spares
    // them but would still walk everything they started.
    const byPid = new Map(rows.map((r) => [r.pid, r]))
    const hostLine = new Set<number>()
    for (let r = byPid.get(d.hostPid); r && !hostLine.has(r.pid); ) {
      hostLine.add(r.pid)
      const parent = byPid.get(r.ppid)
      r = parent && parent.created <= r.created ? parent : undefined
    }
    const named = rows.filter((r) => !hostLine.has(r.pid) && (namesWorktree(r.cmd, dir, d.platform) || namesWorktree(r.exe ?? '', dir, d.platform)))
    // The named rows go in as seeds, not as the worktree: `toStop`'s worktree rule takes orphans only, and a
    // folder about to be removed is held just as much by a process whose parent lives.
    const stop = toStop([...(d.remembered?.(dir) ?? []), ...named], rows, null, d.platform, { liveRoots: d.liveRoots(), hostPid: d.hostPid })
    if (stop.length === 0) return []
    await d.stop(stop)
    d.log(`stopped ${stop.length} process(es) still running in ${dir} before its removal: ${stop.map((r) => `${r.name || 'process'} ${r.pid}`).join(', ')}`)
    return stop
  } catch (err) {
    d.log(`the processes still running in ${dir} could not be stopped: ${String(err)}`)
    return []
  }
}

/** The real machine's deps, as index.ts gives the leftover tracker: Windows and Linux only (macOS has no list). */
export function hostProcessDeps(o: Pick<StopInDeps, 'liveRoots' | 'remembered' | 'log'>): StopInDeps {
  const platform = process.platform
  return {
    platform,
    hostPid: process.pid,
    liveRoots: o.liveRoots,
    ...(o.remembered ? { remembered: o.remembered } : {}),
    list: () => (platform === 'win32' ? queryWindowsProcesses() : platform === 'linux' ? readLinuxProcesses() : Promise.resolve([])),
    stop: (rows) => stopProcesses(rows, { platform, log: o.log }),
    log: o.log
  }
}
