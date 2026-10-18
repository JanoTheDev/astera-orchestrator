// W9-H: a wall tile shows the session's own xterm, never a second one (DESIGN §2 "Tiles render the real terminals").
// TerminalView keeps the one terminal a session has (sessionBus has one consumer per session, and its scrollback lives
// only in that xterm), so a tile borrows it: TerminalView registers what can be moved, a tile claims it into its own
// element, and releasing it puts it back in its pane. No process is spawned or re-attached, and no bytes are replayed.
//
// Only one claim at a time per session: a later claim takes it over, and an earlier claim's release then does nothing.

export interface Dockable {
  /** Moves the terminal into `anchor` in tile mode (small font, read-only, the pty's own size). */
  show(anchor: HTMLElement): void
  /** Puts it back in its pane at its own size. */
  home(): void
}

const dockables = new Map<string, Dockable>()
const claims = new Map<string, { anchor: HTMLElement; token: object }>()

/** TerminalView's side. A claim made before it mounted is honoured now. */
export function registerDockable(sessionId: string, d: Dockable): () => void {
  dockables.set(sessionId, d)
  const held = claims.get(sessionId)
  if (held) d.show(held.anchor)
  return () => {
    if (dockables.get(sessionId) === d) dockables.delete(sessionId)
  }
}

/** The tile's side: shows the session's terminal in `anchor` until the returned release is called. */
export function claimTerminal(sessionId: string, anchor: HTMLElement): () => void {
  const token = {}
  claims.set(sessionId, { anchor, token })
  dockables.get(sessionId)?.show(anchor)
  return () => {
    if (claims.get(sessionId)?.token !== token) return
    claims.delete(sessionId)
    dockables.get(sessionId)?.home()
  }
}
