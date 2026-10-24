// The facts one session row shows on its right, shared by the Agents side bar and the other Sessions surface:
// how long ago (elapsed for a live session, last active for a finished one) and the model with its effort.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "<1m", "12m" under an hour, "3h" under a day, else the short date ("Oct 21"). A clock behind `fromMs` reads "<1m". */
export function elapsedLabel(fromMs: number, nowMs: number): string {
  const d = nowMs - fromMs
  if (d < MINUTE) return '<1m'
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m`
  if (d < DAY) return `${Math.floor(d / HOUR)}h`
  return new Date(fromMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "opus · high", "opus", "high"; "" when neither is known. */
export function modelEffortLabel(model?: string, effort?: string): string {
  return [model, effort].filter(Boolean).join(' · ')
}

/** The time a row counts from: a live session's start; a finished one's last sign of life, else its start (a planner
 *  has no Dispatch and may have made no tool call, and its row showed no time at all). `started` says which. */
export function rowTimeOf(s: { startedAt?: number; lastActiveAt?: number }, finished: boolean): { at: number; started: boolean } | null {
  if (finished && s.lastActiveAt !== undefined) return { at: s.lastActiveAt, started: false }
  return s.startedAt !== undefined ? { at: s.startedAt, started: true } : null
}
