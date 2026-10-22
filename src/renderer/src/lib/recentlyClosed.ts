// T13 (decision 13): closing a session's tab, and taking it back. An agent's tab (worker, coordinator, planner,
// reviewer) hides: its process keeps running and its tile stays on Home. The owner's own console asks once, End or
// Keep running, unless "Don't ask again" stored the answer. Every hidden or ended tab lands in Recently closed (the
// last 20, kept in this window's localStorage like the other workbench prefs), which reopens it: a hidden one is put
// back in the pane tree, an ended one resumes from its transcript in a new tab.
//
// Pure rules plus two tiny stores, so the node-only suite reaches all of it; useWorkbench wires the effects.
import type { SessionKind } from '../../../core/types'

export interface ClosedTab {
  sessionId: string
  title: string
  cwd: string
  accountId: string
  kind?: SessionKind
  bypassPermissions?: boolean
  /** A chat session's protocol thread, what its resume needs. */
  threadId?: string
  /** Epoch ms. */
  closedAt: number
  /** Its process had ended when the tab closed (a hidden tab's may end later: reopen reads the live status). */
  ended: boolean
}

export const RECENT_MAX = 20
const LIST_KEY = 'cm.tabs.recentlyClosed'
const PREF_KEY = 'cm.tabs.closeOwnConsole'

/** Newest first, one entry per session, at most RECENT_MAX. */
export function remember(list: readonly ClosedTab[], entry: ClosedTab): ClosedTab[] {
  return [entry, ...list.filter((x) => x.sessionId !== entry.sessionId)].slice(0, RECENT_MAX)
}

export function forget(list: readonly ClosedTab[], sessionId: string): ClosedTab[] {
  return list.filter((x) => x.sessionId !== sessionId)
}

/** How a reopen goes: a session still running is put back in the tree; an ended one resumes from its transcript. */
export function reopenWayOf(status: 'running' | 'exited' | undefined): 'attach' | 'resume' {
  return status === 'running' ? 'attach' : 'resume'
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // a window without storage keeps the list in memory only
  }
}

let list: ClosedTab[] | null = null
const listeners = new Set<() => void>()

/** The list (useSyncExternalStore's snapshot: the same array until it changes). */
export function recentlyClosed(): ClosedTab[] {
  if (list === null) {
    const stored = read<unknown>(LIST_KEY, [])
    list = Array.isArray(stored) ? (stored as ClosedTab[]).filter((x) => typeof x?.sessionId === 'string').slice(0, RECENT_MAX) : []
  }
  return list
}

export function subscribeRecentlyClosed(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const setList = (next: ClosedTab[]): void => {
  list = next
  write(LIST_KEY, next)
  for (const l of listeners) l()
}
export const recordClosed = (entry: ClosedTab): void => setList(remember(recentlyClosed(), entry))
export const dropClosed = (sessionId: string): void => setList(forget(recentlyClosed(), sessionId))

/** The tab strip's menu and Ctrl+Shift+T call this; useWorkbench sets what it does. No id: the newest. */
let reopenHandler: (entry: ClosedTab) => void = () => {}
export const setReopenHandler = (fn: (entry: ClosedTab) => void): void => {
  reopenHandler = fn
}
export function reopenClosed(sessionId?: string): void {
  const all = recentlyClosed()
  const entry = sessionId === undefined ? all[0] : all.find((x) => x.sessionId === sessionId)
  if (entry) reopenHandler(entry)
}

/** The sessions an agent started, which hide on close without asking. AgentsPage feeds it from the workspace tree. */
let agentSessions: ReadonlySet<string> = new Set()
export const setAgentSessions = (ids: Iterable<string>): void => {
  agentSessions = new Set(ids)
}
export const isAgentSession = (id: string): boolean => agentSessions.has(id)

export type CloseHow = 'hide' | 'end'
export const ownConsolePref = (): CloseHow | null => {
  const v = read<unknown>(PREF_KEY, null)
  return v === 'hide' || v === 'end' ? v : null
}
export const setOwnConsolePref = (v: CloseHow): void => write(PREF_KEY, v)

export interface CloseDeps {
  isAgent(sessionId: string): boolean
  status(sessionId: string): 'running' | 'exited' | undefined
  pref(): CloseHow | null
  setPref(v: CloseHow): void
  /** The owner's choice for their own running console: End, or Keep running; `remember` is "Don't ask again". */
  ask(): Promise<{ how: CloseHow; remember: boolean }>
  hide(sessionId: string): void
  end(sessionId: string): void
}

/** A session tab's close. `how` given (a tile's menu, auto-close) is done as said; otherwise an agent's tab hides, an
 *  ended console just closes, and the owner's running console follows the stored answer or asks. */
export async function closeSessionTab(sessionId: string, how: CloseHow | undefined, deps: CloseDeps): Promise<CloseHow> {
  const pick = async (): Promise<CloseHow> => {
    if (how) return how
    if (deps.isAgent(sessionId)) return 'hide'
    if (deps.status(sessionId) !== 'running') return 'end'
    const stored = deps.pref()
    if (stored) return stored
    const answer = await deps.ask()
    if (answer.remember) deps.setPref(answer.how)
    return answer.how
  }
  const chosen = await pick()
  if (chosen === 'hide') deps.hide(sessionId)
  else deps.end(sessionId)
  return chosen
}
