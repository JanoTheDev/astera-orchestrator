import type { TerminalBuffer, TerminalInfo } from '../../../core/types'

/** What the bottom panel's terminal list becomes when main says it has taken a terminal back from the
 *  Host (`terminal:created`). Returns the list it was given, unchanged, when nothing should move — a
 *  new array would re-render the panel over a terminal it is not even showing.
 *
 *  Three rules, and each of them is a mistake this could otherwise make:
 *
 *  - **Another project's terminal is not shown.** Main holds terminals per project and the panel
 *    draws one project's; the list query filters exactly this way, so the event has to as well.
 *  - **A terminal already on screen gets no second tab.** The reattach sweep skips a terminal the app
 *    still holds live, so this should not arise — but two sweeps queued behind each other, or a
 *    replayed event, must not put two tabs on one shell, each writing into the same pty.
 *  - **The replay buffer starts empty**, because the manager's does: an adopted terminal's buffer only
 *    ever held what the app saw, and the app saw nothing across the restart. The Host's own ring
 *    buffer arrives afterwards as ordinary `terminal:data` — main emits this event before it asks for
 *    that replay, so the tab is mounted and listening by the time the first chunk crosses back.
 *
 *  A pure function because App.tsx is not reachable by a test, following `quitConfirmBody`. */
export function terminalsWithCreated(
  prev: TerminalBuffer[],
  info: TerminalInfo,
  showing: string | null
): TerminalBuffer[] {
  if (!showing || info.projectPath !== showing) return prev
  if (prev.some((x) => x.id === info.id)) return prev
  return [...prev, { id: info.id, buffer: '' }]
}

/** The exit code main gives every Host-backed handle when it loses sight of the Host (PTY_LOST_SIGHT_EXIT_CODE in
 *  core/sessions/pty.ts, which the renderer cannot import): a handover to the next Host, or a dropped socket. */
export const LOST_SIGHT_EXIT_CODE = -1
/** How long a lost shell's tab waits for its Host to give it back (`terminal:created`, same id) before it goes. */
export const LOST_TERMINAL_GRACE_MS = 30_000

/** What the list becomes on `terminal:exit`. A shell that ended by itself loses its tab — a dead shell tab is noise.
 *  One the app only lost sight of keeps it: the next Host (a handover) or the same one (a reconnect) opens it again
 *  under the same id, and `terminalsWithCreated` then finds it in place. The caller drops it after
 *  LOST_TERMINAL_GRACE_MS if nothing gives it back. */
export function terminalsWithExit(prev: TerminalBuffer[], e: { id: string; exitCode: number }): TerminalBuffer[] {
  if (e.exitCode === LOST_SIGHT_EXIT_CODE) return prev
  return prev.filter((x) => x.id !== e.id)
}
