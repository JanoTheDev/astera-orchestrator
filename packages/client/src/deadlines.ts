// How long a client waits for the Host's answer (the CLI's rule and the SDK's).
// Imports nothing: the app's renderer reaches these deadlines through its public protocol module.

/** The Host's default long-poll deadline for `runs wait`, `jobs wait` and `sessions send --wait`. The Host and every
 *  client read it from here: two copies would drift. */
export const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60_000
/** The Host's default deadline for `ask`. */
export const DEFAULT_ASK_TIMEOUT_MS = 600_000
/** The Host's default long-poll deadline for `check --wait`. */
export const DEFAULT_CHECK_TIMEOUT_MS = 300_000

/** Headroom on top of the Host's deadline, so a client never gives up before the Host does. It absorbs the Host's
 *  polling interval and the event-loop delay before it sends its answer; with less, the client's own timer fires
 *  while the Host is still preparing the answer, and a timeout that is information becomes an error. */
export const TIMEOUT_HEADROOM_MS = 30_000

/**
 * How long to wait for one call's answer. A command that waits on the Host gets the Host's deadline plus headroom:
 * the one the call names in `args.timeoutMs`, else the Host's default for that command. Every other command gets
 * `ordinaryMs`.
 */
export function callDeadlineMs(a: { cmd: string; args: Record<string, unknown> }, ordinaryMs: number): number {
  if (typeof a.args.timeoutMs === 'number') return a.args.timeoutMs + TIMEOUT_HEADROOM_MS
  if (a.cmd === 'ask') return DEFAULT_ASK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS
  if (a.cmd === 'jobs-wait' || a.cmd === 'runs-wait' || (a.cmd === 'sessions-send' && a.args.wait === true))
    return DEFAULT_WAIT_TIMEOUT_MS + TIMEOUT_HEADROOM_MS
  if (a.cmd === 'check') return DEFAULT_CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS
  return ordinaryMs
}

/** How long one `runs-follow` call holds on the Host when nothing happens. The Host takes up to a minute; a client
 *  that asks for a shorter window sees its own deadline and an abort sooner. */
export const FOLLOW_WINDOW_MS = 20_000
