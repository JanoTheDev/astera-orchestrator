// T28: an outdated Host (the app was updated, the Host still runs the previous build) as one state the app's main
// process drives (main/ipc.ts `maybeReplace`, `restartHostNow`) and the window shows ("Host update waiting: N agents
// still running"). Pure and node-free, so the renderer can import it and a test can reach every transition.
import type { MessageKey, MessageParams } from '../i18n'
import type { HostRestartState } from '../types'
import { hostRestartMessage } from './restartView'

/** With "Restart the Host when idle" on, how long the held restart waits for the working agents to reach their prompt
 *  before it hands every session over anyway (the handover keeps the dispatched Tasks). */
export const HOST_UPDATE_HANDOVER_AFTER_MS = 30 * 60_000

export type HostUpdateBlockedReason = Exclude<Extract<HostRestartState, { phase: 'failed' }>['reason'], 'quitting'>

export type HostUpdateState =
  | { kind: 'current' }
  /** Outdated, and waiting: `agentsRunning` working Tasks, `sessionsBlocking` chats mid-turn, since `since`. */
  | { kind: 'outdated-waiting'; agentsRunning: number; sessionsBlocking: number; since: number }
  /** The Host is handing over and leaving; the new build is coming up. `since`: when the wait began. */
  | { kind: 'restarting'; since: number }
  /** A restart was refused or failed. No automatic restart is tried again; "Restart now" still is. */
  | { kind: 'outdated-blocked'; reason: HostUpdateBlockedReason }

export type HostUpdateEvent =
  /** A look at the Host: whether it is older than the app, and what is still running on it. */
  | { t: 'observe'; outdated: boolean; agentsRunning: number; sessionsBlocking: number; nowMs: number }
  /** The Host took the restart and is leaving. */
  | { t: 'leaving'; nowMs: number }
  /** The restart ended: `ok` with the new Host answering, or failed for `reason`. */
  | { t: 'ended'; ok: true }
  | { t: 'ended'; ok: false; reason: HostUpdateBlockedReason }

/** What the window is given: the state, and the owner's toggle beside it. */
export interface HostUpdateView {
  state: HostUpdateState
  restartWhenIdle: boolean
}

export const HOST_UPDATE_CURRENT: HostUpdateState = { kind: 'current' }

export function nextHostUpdateState(s: HostUpdateState, e: HostUpdateEvent): HostUpdateState {
  switch (e.t) {
    case 'observe':
      if (!e.outdated) return HOST_UPDATE_CURRENT
      // The old Host is on its way out, or its restart failed: neither is undone by what it still runs.
      if (s.kind === 'restarting' || s.kind === 'outdated-blocked') return s
      return { kind: 'outdated-waiting', agentsRunning: e.agentsRunning, sessionsBlocking: e.sessionsBlocking, since: s.kind === 'outdated-waiting' ? s.since : e.nowMs }
    case 'leaving':
      return { kind: 'restarting', since: s.kind === 'outdated-waiting' || s.kind === 'restarting' ? s.since : e.nowMs }
    case 'ended':
      return e.ok ? HOST_UPDATE_CURRENT : { kind: 'outdated-blocked', reason: e.reason }
  }
}

/** With the toggle on, the wait the held restart is asked for (`restart`'s `waitMs`): what is left of the 30 minutes
 *  since the wait began, 0 once they are over (hand over now). Null when no automatic restart is due: the Host is
 *  current, already restarting, or its restart failed. */
export function hostUpdateRestartWaitMs(s: HostUpdateState, nowMs: number): number | null {
  if (s.kind !== 'outdated-waiting') return null
  return Math.max(0, s.since + HOST_UPDATE_HANDOVER_AFTER_MS - nowMs)
}

/** The status bar's banner for an outdated Host: "Host update waiting: N agents still running" (chats mid-turn are agents
 *  too), or why its restart failed. Null: nothing to say beyond the plain offer. */
export function hostUpdateBanner(u: HostUpdateView | undefined): { key: MessageKey; params?: MessageParams } | null {
  if (u?.state.kind === 'outdated-waiting') return { key: 'status.hostUpdateWaiting', params: { n: u.state.agentsRunning + u.state.sessionsBlocking } }
  if (u?.state.kind === 'outdated-blocked') return hostRestartMessage({ phase: 'failed', reason: u.state.reason })
  return null
}

/** Whether two states read the same, so main pushes the window only on a change. */
export function sameHostUpdateState(a: HostUpdateState, b: HostUpdateState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
