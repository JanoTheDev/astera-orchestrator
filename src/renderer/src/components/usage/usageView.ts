// W6-G: what the plan view's usage strip draws, from main's `usage.guard` (UsageGuardView). Pure, so the node-only
// test suite reaches it.
import type { Account, JobTask, RateLimitWindow, UsageGuardView } from '../../../../core/types'
import { resetClock } from '../../../../core/orchestration/activity'
import { poolRunOutOf, runOutOf, SESSION_WINDOW_MS, WEEKLY_WINDOW_MS, type RunOut } from './runOut'

/** How often the strip asks again. The guard itself reads on its own minute timer; this only redraws. */
export const USAGE_STRIP_POLL_MS = 30_000

export interface StripWindow {
  percent: number
  /** "14:20", or "Mon 14:20" for the 7-day window; null when the reading did not say. */
  resets: string | null
  /** At or over the threshold. */
  over: boolean
}

export interface StripRows {
  accounts: Array<{ accountId: string; label: string; fiveHour: StripWindow | null; sevenDay: StripWindow | null; paused: boolean; runOutInMs: number | null }>
  /** All accounts together: ms until the soonest pool runs out, null = lasts until the resets; the object itself is null with no estimate. */
  pool: { runOutInMs: number | null } | null
  /** Tabs with live subagents, named by the Task they work on when the plan has it. */
  subagents: Array<{ sessionId: string; label: string; count: number }>
  pauseAt: number
  maxSubagents: number
}

const windowOf = (w: RateLimitWindow | null, weekly: boolean, pauseAt: number): StripWindow | null =>
  w === null ? null : { percent: w.usedPercent, resets: w.resetsAt === null ? null : resetClock(w.resetsAt, weekly), over: w.usedPercent >= pauseAt }

const soonest = (runs: Array<RunOut | null>, now: number): number | null => {
  const at = runs.flatMap((r) => (r?.runsOutAt != null ? [r.runsOutAt] : []))
  return at.length === 0 ? null : Math.max(0, Math.min(...at) - now)
}

const poolOf = (view: UsageGuardView, now: number): StripRows['pool'] => {
  const sessions = view.accounts.flatMap((a) => (a.session ? [a.session] : []))
  const weeklies = view.accounts.flatMap((a) => (a.weekly ? [a.weekly] : []))
  const runs = [poolRunOutOf(sessions, SESSION_WINDOW_MS, now), poolRunOutOf(weeklies, WEEKLY_WINDOW_MS, now)]
  return runs.every((r) => r === null) ? null : { runOutInMs: soonest(runs, now) }
}

export function stripRows(view: UsageGuardView, accounts: readonly Account[] | null, tasks: readonly JobTask[], now = Date.now()): StripRows {
  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const taskOf = new Map(tasks.flatMap((t) => (t.sessionId !== undefined ? [[t.sessionId, t.title] as const] : [])))
  return {
    accounts: view.accounts.map((a) => ({
      accountId: a.accountId,
      label: label(a.accountId),
      fiveHour: windowOf(a.session, false, view.pauseAt),
      sevenDay: windowOf(a.weekly, true, view.pauseAt),
      paused: a.paused !== null,
      // the paused / over-threshold states come first; the estimate only speaks for an account that has neither
      runOutInMs:
        a.paused !== null || [a.session, a.weekly].some((w) => w !== null && w.usedPercent >= view.pauseAt)
          ? null
          : soonest([a.session && runOutOf(a.session, SESSION_WINDOW_MS, now), a.weekly && runOutOf(a.weekly, WEEKLY_WINDOW_MS, now)], now)
    })),
    pool: poolOf(view, now),
    subagents: view.subagents.map((s) => ({ sessionId: s.sessionId, label: taskOf.get(s.sessionId) ?? s.sessionId.slice(0, 8), count: s.count })),
    pauseAt: view.pauseAt,
    maxSubagents: view.maxSubagents
  }
}
