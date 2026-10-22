import type { RateLimitWindow } from '../../../../core/types'

export const SESSION_WINDOW_MS = 5 * 3_600_000
export const WEEKLY_WINDOW_MS = 7 * 24 * 3_600_000

const MIN_ELAPSED_MS = 10 * 60_000
const MIN_PERCENT = 3
const HOUR_MS = 3_600_000

export interface RunOut {
  ratePerHour: number
  /** Epoch ms when the window hits 100%; null when it lasts until the reset. */
  runsOutAt: number | null
}

// shortcut: average since window start, cannot see a recent burst; keep a short ring of readings per account if that matters.
export function runOutOf(w: RateLimitWindow, windowMs: number, now: number): RunOut | null {
  const resetsAt = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  if (!Number.isFinite(resetsAt)) return null
  const elapsed = now - (resetsAt - windowMs)
  if (elapsed < MIN_ELAPSED_MS || elapsed > windowMs || w.usedPercent < MIN_PERCENT) return null
  const ratePerHour = w.usedPercent / (elapsed / HOUR_MS)
  const runsOutAt = w.usedPercent >= 100 ? now : now + ((100 - w.usedPercent) / ratePerHour) * HOUR_MS
  return { ratePerHour, runsOutAt: runsOutAt < resetsAt ? runsOutAt : null }
}

/** All accounts together: summed remaining budget against summed burn of the windows that have an estimate. */
export function poolRunOutOf(windows: readonly RateLimitWindow[], windowMs: number, now: number): RunOut | null {
  let remaining = 0
  let rate = 0
  let latestReset = -Infinity
  let estimated = false
  for (const w of windows) {
    remaining += Math.max(0, 100 - w.usedPercent)
    const r = runOutOf(w, windowMs, now)
    if (!r) continue
    estimated = true
    rate += r.ratePerHour
    latestReset = Math.max(latestReset, Date.parse(w.resetsAt as string))
  }
  if (!estimated) return null
  const runsOutAt = now + (remaining / rate) * HOUR_MS
  return {
    ratePerHour: rate,
    runsOutAt: runsOutAt < latestReset ? runsOutAt : null
  }
}
