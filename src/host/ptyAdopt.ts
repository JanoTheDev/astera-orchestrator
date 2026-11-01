// T36 (owner item 25b): after a Host crash the agent ptys live on in the pty supervisor (ptySupervisor/protocol.ts),
// and the next Host takes them back instead of starting each agent a second time in the same worktree.
//
// **When.** The list is asked before this Host serves (`listSurvivors`), and the ptys are adopted right after its
// address is ours, before any command can load the plans (`adoptSurvivors`, synchronous): the load's restart cleanup
// then counts every adopted session alive (index.ts `aliveSessionIds`), so its Dispatch stays open and neither the
// recovery nor crash resume reads it as lost. A Host that loses the bind race touches none of them.
//
// **Which.** A live agent pty whose session the last Host saved (live-sessions.json) or whose session an open Dispatch
// names is registered under its note, so the app, the transcripts and `astera sessions` see it as before; its ring
// replays first, then the live output. Any other pty is killed (its whole tree) and said once. A saved session with no
// pty left is restored as before (sessionRestore.ts), and a supervisor out of reach adopts nothing.
import type { OrchState } from '../core/orchestration/state'
import type { PtySupervisorClient } from './ptySupervisor/client'
import type { SupervisorPtyInfo } from './ptySupervisor/protocol'
import type { PtyRegistry } from './registry'
import type { SavedSession } from './sessionRestore'

/** How long the start waits for the supervisor's list: after a crash it is already running and answers at once. */
export const ADOPT_LIST_MS = 5_000
/** The size an adopted pty is registered at until an app gives it its own (the supervisor does not say its size). */
const COLS = 120
const ROWS = 30

/** The supervisor's ptys; null when it cannot be reached or does not answer in `waitMs` (said once). Never rejects. */
export async function listSurvivors(
  supervisor: Pick<PtySupervisorClient, 'list'>,
  log: (m: string) => void,
  waitMs = ADOPT_LIST_MS
): Promise<SupervisorPtyInfo[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)))
    const got = await Promise.race([supervisor.list(), timeout])
    if (got) return got
    log(`pty adopt: the pty supervisor did not list its ptys within ${waitMs} ms; the sessions restore as before`)
  } catch (err) {
    log(`pty adopt: the pty supervisor cannot be reached (${String(err)}); the sessions restore as before`)
  } finally {
    clearTimeout(timer)
  }
  return null
}

/** Registers each live agent pty a saved session or an open Dispatch names, kills the rest. Returns the adopted session
 *  ids. Synchronous: see the header. */
export function adoptSurvivors(d: {
  survivors: readonly SupervisorPtyInfo[]
  supervisor: Pick<PtySupervisorClient, 'attach'>
  registry: Pick<PtyRegistry, 'open'>
  /** live-sessions.json as the last Host left it. */
  saved: readonly SavedSession[]
  /** orchestration.json as the crash left it, before any load. */
  state: OrchState | null
  log(m: string): void
}): Set<string> {
  const rows = new Map(d.saved.map((r) => [r.sessionId, r]))
  const open = new Set((d.state?.dispatches ?? []).filter((x) => !x.endedAt && !x.outcome).map((x) => x.sessionId))
  const adopted = new Set<string>()
  const killed: string[] = []
  for (const p of d.survivors) {
    if (!p.alive) continue
    const sid = p.note?.kind === 'session' ? p.note.id : null
    if (!p.note || sid === null || (!rows.has(sid) && !open.has(sid))) {
      d.supervisor.attach(p.id, p.pid).kill()
      killed.push(`${p.id} (pid ${p.pid}${sid ? `, session ${sid}` : ''})`)
      continue
    }
    const cwd = typeof p.note.restore.cwd === 'string' ? p.note.restore.cwd : (rows.get(sid)?.cwd ?? '')
    const r = d.registry.open({
      id: p.id,
      file: '',
      args: [],
      opts: { cwd, cols: COLS, rows: ROWS, env: {} },
      meta: p.note,
      pty: d.supervisor.attach(p.id, p.pid)
    })
    if (r.ok) adopted.add(sid)
    else d.log(`pty adopt: session ${sid} (pty ${p.id}) could not be registered: ${r.error}`)
  }
  if (killed.length > 0) d.log(`pty adopt: killed ${killed.length} pty(s) no saved session or open Dispatch names: ${killed.join(', ')}`)
  if (adopted.size > 0) d.log(`pty adopt: took back ${adopted.size} live session(s) from the pty supervisor: ${[...adopted].join(', ')}`)
  return adopted
}
