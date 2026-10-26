// T5: the app lowers Astera's auto-limits when its own processes show overload: a renderer or child that died with
// reason 'oom', or a window that keeps freezing. Only lowers limits; never closes, reloads or kills anything.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { effectiveCap, readAutoLimitsSync, updateAutoLimits, type AutoLimit, type AutoLimits } from '../core/settings/autoLimits'
import { machineSpecs } from '../core/settings/machineSpecs'

export const FREEZE_MIN_MS = 5_000
export const FREEZE_WINDOW_MS = 10 * 60_000
export const FREEZES_TO_LOWER = 2

const HISTORY_MAX = 20

function lowerWorkers(cur: AutoLimits, cap: number, cause: AutoLimit['cause'], at: string, detail: string): AutoLimits {
  const from = cur.workers?.cap ?? null
  // never raise an existing lower cap
  const to = from === null ? cap : Math.min(from, cap)
  // an 'oom' on a same-valued 'strain' cap still takes it over: only 'strain' caps are raised again by the Host
  const changed = to !== from || (cause === 'oom' && cur.workers?.cause !== 'oom')
  if (!changed) return cur
  return {
    ...cur,
    workers: { cap: to, cause, at, detail },
    history: [...cur.history, { at, what: 'workers' as const, from, to, cause, detail }].slice(-HISTORY_MAX)
  }
}

/** The renderer or a child ran out of memory: one fewer worker than were live (never above the effective cap), checks wait for a heavy slot too. Sticky: the Host monitor only raises 'strain' caps. */
export function oomLowering(a: {
  what: 'renderer' | string
  effectiveWorkers: number
  liveWorkers: number
  now: string
}): (cur: AutoLimits) => AutoLimits {
  const cap = Math.max(1, Math.min(a.effectiveWorkers, Math.max(a.liveWorkers, 1)) - 1)
  const detail = `The window ran out of memory while ${a.liveWorkers} agents ran`
  return (cur) => {
    const next = lowerWorkers(cur, cap, 'oom', a.now, detail)
    return { ...next, checksAsHeavy: cur.checksAsHeavy ?? { cause: 'oom', at: a.now } }
  }
}

/** Counts window freezes (unresponsive until responsive) and says when to lower: 2 episodes of >= 5 s within 10 min, then quiet for 10 min. */
export class UnresponsiveCounter {
  private since: number | null = null
  private episodes: number[] = []
  private lastLowered: number | null = null

  unresponsive(nowMs: number): void {
    this.since ??= nowMs
  }

  /** The window answered again. True when this episode makes it time to lower. */
  responsive(nowMs: number): boolean {
    const since = this.since
    this.since = null
    if (since === null || nowMs - since < FREEZE_MIN_MS) return false
    this.episodes = [...this.episodes.filter((t) => nowMs - t < FREEZE_WINDOW_MS), nowMs]
    if (this.episodes.length < FREEZES_TO_LOWER) return false
    if (this.lastLowered !== null && nowMs - this.lastLowered < FREEZE_WINDOW_MS) return false
    this.lastLowered = nowMs
    return true
  }

  /** How many long freezes the last 10 minutes hold, for the history line. */
  count(nowMs: number): number {
    return this.episodes.filter((t) => nowMs - t < FREEZE_WINDOW_MS).length
  }
}

/** One step below the effective cap (floor 1), cause 'strain' so the Host monitor's calm raise brings it back. */
export function freezeLowering(a: { effectiveWorkers: number; freezes: number; now: string }): (cur: AutoLimits) => AutoLimits {
  const cap = Math.max(1, a.effectiveWorkers - 1)
  const detail = `The window froze ${a.freezes} times in 10 minutes`
  return (cur) => lowerWorkers(cur, cap, 'strain', a.now, detail)
}

/** The worker cap in force, read from the profile (the person's value or the machine's recommendation, lowered by the auto-limit). Never throws. */
export function effectiveWorkersIn(profileDir: string): number {
  let person: number | null = null
  try {
    const v = (JSON.parse(readFileSync(path.join(profileDir, 'app-settings.json'), 'utf8')) as { maxConcurrentWorkers?: unknown }).maxConcurrentWorkers
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1) person = v
  } catch {
    /* no settings file: the recommendation */
  }
  return effectiveCap(person ?? machineSpecs().recommended, readAutoLimitsSync(profileDir).workers)
}

/** shortcut: the live worker count is not reachable from main without the Host client, so the effective cap stands in; wire the Host's session count here when main has it. */
export function lowerForOom(profileDir: string, what: string): void {
  const effectiveWorkers = effectiveWorkersIn(profileDir)
  updateAutoLimits(profileDir, oomLowering({ what, effectiveWorkers, liveWorkers: effectiveWorkers, now: new Date().toISOString() })).catch((err) =>
    console.error(`oom limit lowering failed (${err instanceof Error ? err.name : typeof err})`)
  )
}

interface WindowLike {
  on(event: 'unresponsive' | 'responsive', l: () => void): unknown
}

/** index.ts's one call per window: its freezes feed the counter, and a second long freeze in 10 minutes lowers the workers cap one step. */
export function watchWindowFreezes(
  win: WindowLike,
  deps: { profileDir: string; effectiveWorkers?: () => number; now?: () => number }
): void {
  const counter = new UnresponsiveCounter()
  const now = deps.now ?? Date.now
  win.on('unresponsive', () => counter.unresponsive(now()))
  win.on('responsive', () => {
    const t = now()
    if (!counter.responsive(t)) return
    const effectiveWorkers = deps.effectiveWorkers?.() ?? effectiveWorkersIn(deps.profileDir)
    updateAutoLimits(deps.profileDir, freezeLowering({ effectiveWorkers, freezes: counter.count(t), now: new Date(t).toISOString() })).catch((err) =>
      console.error(`freeze limit lowering failed (${err instanceof Error ? err.name : typeof err})`)
    )
  })
}
