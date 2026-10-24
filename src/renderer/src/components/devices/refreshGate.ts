// Decides whether a refresh of the devices store runs now. A forced one (Refresh button, after an add or a change)
// always runs. A refresh on show is skipped while one is in flight or one finished within `freshMs`, so showing the
// view twice in a row asks the devices once. No timer: the window is only compared against when the view is shown.
export const DEVICES_FRESH_MS = 15_000

export function createRefreshGate(now: () => number = Date.now, freshMs = DEVICES_FRESH_MS) {
  let inflight = 0
  let finishedAt = -Infinity
  return {
    /** True when the caller should refresh; then it must call `end` when its refresh settles. */
    begin(force: boolean): boolean {
      if (!force && (inflight > 0 || now() - finishedAt < freshMs)) return false
      inflight++
      return true
    },
    end(): void {
      inflight--
      finishedAt = now()
    }
  }
}
