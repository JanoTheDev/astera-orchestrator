// T5: the app lowers Astera's auto-limits when its own processes show overload: a renderer or child that died with
// reason 'oom', or a window that keeps freezing. Only lowers limits; never closes, reloads or kills anything.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AutoLimitsReadOnlyError, effectiveCap, readAutoLimitsSync, updateAutoLimits, type AutoLimit, type AutoLimits } from '../core/settings/autoLimits'
import { clampLowering, lowerPolicyOf, type LowerPolicy } from '../core/settings/autoLowerLimits'
import { machineSpecs } from '../core/settings/machineSpecs'

export const FREEZE_MIN_MS = 5_000
export const FREEZE_WINDOW_MS = 10 * 60_000
export const FREEZES_TO_LOWER = 2

/** What the lowerings below do when they are given no policy: lower freely, as before the auto-lower setting. */
const FREE: LowerPolicy = { mode: 'on', floor: 1 }

const HISTORY_MAX = 20

/** The workers cap a lowering to `proposed` may set under the policy, or null when it may set none: the setting is off,
 *  or the floor holds it at the cap in force. */
function allowedCap(policy: LowerPolicy, proposed: number, effectiveWorkers: number): number | null {
  if (policy.mode === 'on') return proposed
  const cap = clampLowering(policy.mode, policy.floor, proposed, effectiveWorkers)
  return cap < effectiveWorkers ? cap : null
}

function lowerWorkers(cur: AutoLimits, cap: number, cause: AutoLimit['cause'], at: string, detail: string): AutoLimits {
  const from = cur.workers?.cap ?? null
  // never raise an existing lower cap
  const to = from === null ? cap : Math.min(from, cap)
  // an 'oom' on a same-valued 'strain' cap still takes it over: only 'strain' caps are raised again by the Host
  const changed = to !== from || (cause === 'oom' && cur.workers?.cause !== 'oom')
  if (!changed) return cur
  // a 'strain' lowering keeps a crash or OOM cause, so the Host monitor does not raise it back on its calm timer
  const keep = cur.workers?.cause
  const capCause = cause === 'strain' && (keep === 'crash' || keep === 'oom') ? keep : cause
  return {
    ...cur,
    workers: { cap: to, cause: capCause, at, detail },
    history: [...cur.history, { at, what: 'workers' as const, from, to, cause, detail }].slice(-HISTORY_MAX)
  }
}

/** The renderer or a child ran out of memory: one fewer worker than were live (never above the effective cap), checks wait for a heavy slot too. Sticky: the Host monitor only raises 'strain' caps.
 *  Under 'floor' the cap stops at the owner's minimum; under 'off' nothing changes. */
export function oomLowering(a: {
  what: 'renderer' | string
  effectiveWorkers: number
  liveWorkers: number
  now: string
  policy?: LowerPolicy
}): (cur: AutoLimits) => AutoLimits {
  const policy = a.policy ?? FREE
  const cap = allowedCap(policy, Math.max(1, Math.min(a.effectiveWorkers, Math.max(a.liveWorkers, 1)) - 1), a.effectiveWorkers)
  const detail = `The window ran out of memory while ${a.liveWorkers} agents ran`
  return (cur) => {
    if (policy.mode === 'off') return cur
    const next = cap === null ? cur : lowerWorkers(cur, cap, 'oom', a.now, detail)
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

/** One step below the effective cap (floor 1), cause 'strain' so the Host monitor's calm raise brings it back. Under
 *  'floor' it stops at the owner's minimum; under 'off' nothing changes. */
export function freezeLowering(a: { effectiveWorkers: number; freezes: number; now: string; policy?: LowerPolicy }): (cur: AutoLimits) => AutoLimits {
  const cap = allowedCap(a.policy ?? FREE, Math.max(1, a.effectiveWorkers - 1), a.effectiveWorkers)
  const detail = `The window froze ${a.freezes} times in 10 minutes`
  return (cur) => (cap === null ? cur : lowerWorkers(cur, cap, 'strain', a.now, detail))
}

interface ProfileSettings {
  maxConcurrentWorkers?: unknown
  autoLowerLimits?: unknown
  minWorkersUnderPressure?: unknown
}

function settingsIn(profileDir: string): { settings: ProfileSettings; person: number } {
  let settings: ProfileSettings = {}
  try {
    settings = JSON.parse(readFileSync(path.join(profileDir, 'app-settings.json'), 'utf8')) as ProfileSettings
  } catch {
    /* no settings file: the recommendation and the defaults */
  }
  const v = settings.maxConcurrentWorkers
  return { settings, person: typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : machineSpecs().recommended }
}

/** The worker cap in force, read from the profile (the person's value or the machine's recommendation, lowered by the auto-limit). Never throws. */
export function effectiveWorkersIn(profileDir: string): number {
  return effectiveCap(settingsIn(profileDir).person, readAutoLimitsSync(profileDir).workers)
}

/** The auto-lower setting and the owner's minimum agents, read from the profile. Never throws. */
export function lowerPolicyIn(profileDir: string): LowerPolicy {
  const { settings, person } = settingsIn(profileDir)
  return lowerPolicyOf(settings, person)
}

/** shortcut: the live worker count is not reachable from main without the Host client, so the effective cap stands in; wire the Host's session count here when main has it. */
export function lowerForOom(profileDir: string, what: string): void {
  const effectiveWorkers = effectiveWorkersIn(profileDir)
  const policy = lowerPolicyIn(profileDir)
  if (policy.mode === 'off') return
  updateAutoLimits(profileDir, oomLowering({ what, effectiveWorkers, liveWorkers: effectiveWorkers, now: new Date().toISOString(), policy })).catch(quietWriteError('oom'))
}

/** A read-only auto-limits.json is the owner's choice: nothing to report. Any other failure is logged by kind. */
function quietWriteError(what: string): (err: unknown) => void {
  return (err) => {
    if (err instanceof AutoLimitsReadOnlyError) return
    console.error(`${what} limit lowering failed (${err instanceof Error ? err.name : typeof err})`)
  }
}

interface WindowLike {
  on(event: 'unresponsive' | 'responsive', l: () => void): unknown
}

/** index.ts's one call per window: its freezes feed the counter, and a second long freeze in 10 minutes lowers the workers cap one step. */
export function watchWindowFreezes(
  win: WindowLike,
  deps: { profileDir: string; effectiveWorkers?: () => number; now?: () => number; policy?: () => LowerPolicy }
): void {
  const counter = new UnresponsiveCounter()
  const now = deps.now ?? Date.now
  win.on('unresponsive', () => counter.unresponsive(now()))
  win.on('responsive', () => {
    const t = now()
    if (!counter.responsive(t)) return
    const effectiveWorkers = deps.effectiveWorkers?.() ?? effectiveWorkersIn(deps.profileDir)
    const policy = (deps.policy ?? (() => lowerPolicyIn(deps.profileDir)))()
    if (policy.mode === 'off') return
    updateAutoLimits(deps.profileDir, freezeLowering({ effectiveWorkers, freezes: counter.count(t), now: new Date(t).toISOString(), policy })).catch(quietWriteError('freeze'))
  })
}
