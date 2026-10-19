// The wait between two reconnects of a connection's inbox, shared by every channel (Slack's socket,
// Telegram's long poll) so a retry loop never hammers the service and never gives up.

/** The first reconnect waits this long, and each failure after it doubles the wait (final review C1). A
 *  healthy socket is recycled by Slack every few hours ("disconnect" with a refresh reason), so the first
 *  wait stays short. */
export const RECONNECT_BASE_MS = 1_000
/** The longest wait between two reconnects: an outage of an hour costs at most five minutes of intake after
 *  it ends, and a Host left running for days never gives up. */
export const RECONNECT_CAP_MS = 5 * 60_000
/** The wait before the reconnect that follows `attempt` consecutive failures (0 for the first). */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(Math.max(0, attempt), 30))
}
