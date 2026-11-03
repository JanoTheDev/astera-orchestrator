// The app's note that it is about to end a Host by force (taskkill /T /F, SIGKILL).
//
// 2026-11-03 07:33: a Host that had stopped answering was replaced from the app ("replacing the Host ... on request"),
// which ends it with taskkill. A forced end runs no exit handler, so the next Host read the stale heartbeat in
// `exit-record.json` and logged "died without a word (native crash?)", and the hunt went to node-pty and V8 for a
// process the app had ended itself. So the app writes this note into the Host folder right before the kill, and the
// next Host (host/exitWatch.ts `previousHostLines`) says who ended the last one and why.
//
// Synchronous and best effort on both sides: a note that cannot be written costs the explanation, never the kill.

/** The note's file name in the Host folder (`<profile>/host`), beside `exit-record.json`. */
export const ENDED_BY_APP = 'ended-by-app.json'

export interface EndedByApp {
  /** The Host process the app ended. */
  pid: number
  /** Epoch ms, right before the kill. */
  at: number
  /** Why, in a few words: "it was not answering". */
  why: string
}

/** Whether process `pid` still runs: signal 0 checks without sending anything. EPERM is a process that is not ours to
 *  signal, so it runs. */
export function hostPidAlive(pid: number, kill: (pid: number, signal: 0) => unknown = (p, s) => process.kill(p, s)): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The note as a file holds it, or null for none or for one that does not read as a note. */
export function parseEndedByApp(raw: string): EndedByApp | null {
  try {
    const v = JSON.parse(raw) as Partial<EndedByApp>
    if (typeof v.pid !== 'number' || typeof v.at !== 'number' || typeof v.why !== 'string') return null
    return { pid: v.pid, at: v.at, why: v.why }
  } catch {
    return null
  }
}
