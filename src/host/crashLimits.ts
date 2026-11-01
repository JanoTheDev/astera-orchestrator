// T2: lower the limits after a crash. The Host's start tells a hard death (no clean-exit marker, no signal marker)
// from a clean exit or a reboot, and lowers the auto-limits (core/settings/autoLimits.ts) for agents, heavy jobs and
// checks in proportion to what ran when it died, so the same load does not take the machine down again. Lowering only
// holds back new starts: nothing running is ended. A crash lowering stays until the person restores it in Settings
// (the load monitor raises only its own 'strain' lowerings back).
//
// Imports only core modules and node builtins: this bundles into the Host.
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ActivityDraft } from '../core/orchestration/activity'
import { inFlightOf } from '../core/orchestration/exec/crashResume'
import type { OrchState } from '../core/orchestration/state'
import {
  readHealthSnapshot,
  takeSignalExit,
  updateAutoLimits,
  writeSignalExitSync,
  AutoLimitsReadOnlyError,
  type AutoLimits,
  type HealthSnapshot
} from '../core/settings/autoLimits'
import { clampLowering, lowerPolicyOf, type LowerPolicy } from '../core/settings/autoLowerLimits'
import { machineSpecs } from '../core/settings/machineSpecs'
import { maxConcurrentWorkersOf } from '../core/settings/maxConcurrentWorkers'
import { readAppSettingsObject } from '../core/settings/settingsObject'
import { cleanExitFileIn, writeCleanExit } from './sessionRestore'

/** A health sample older than this before the start says too little about the moment of death. */
export const HEALTH_FRESH_MS = 120_000

const SIGNALS: readonly string[] = ['SIGINT', 'SIGTERM']

/** The marker `leave` writes on its way out: clean-exit on a deliberate way out (idle, `host stop`, a retire), the
 *  signal on SIGINT/SIGTERM, none on a handover (`resume`, which writes its own after the handover). Sync: nothing
 *  after it is sure to get another turn. Never throws. */
export function markExit(profileDir: string, why: string | undefined, resume: boolean): void {
  if (!why && !resume) writeCleanExit(profileDir)
  else if (why && SIGNALS.includes(why)) writeSignalExitSync(profileDir, why)
}

export interface CrashCounts {
  workers: number
  heavy: number
  checks: number
}

/** What ran when the last Host died: its last health sample when that is younger than HEALTH_FRESH_MS, else what
 *  orchestration.json says was in flight (open Dispatches; Tasks in validation as checks; heavy jobs are not kept
 *  there, so none). */
export function countsAtCrash(a: { health: HealthSnapshot | null; state: OrchState | null; nowMs: number }): CrashCounts {
  const h = a.health
  if (h && a.nowMs - Date.parse(h.at) < HEALTH_FRESH_MS)
    return { workers: h.liveWorkers, heavy: h.heavyRunning, checks: h.checksRunning }
  if (!a.state) return { workers: 0, heavy: 0, checks: 0 }
  return {
    workers: inFlightOf(a.state).dispatchIds.length,
    heavy: 0,
    checks: a.state.tasks.filter((t) => t.status === 'validating').length
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The memory part of a crash detail. An unknown reading (memUnknown) must not read as 100% free; commit headroom is
 *  added when the sample has it (Windows). */
export function memoryText(h: HealthSnapshot): string {
  const mem = h.memUnknown ? 'memory unknown' : `memory ${Math.round(h.memAvailablePct)}% free`
  return typeof h.commitHeadroomPct === 'number' ? `${mem}; commit headroom ${Math.round(h.commitHeadroomPct)}%` : mem
}

/** The lowering a start after a hard death applies, as a change to the auto-limits file; null when there is none:
 *  a clean exit, a signal on a machine that was not strained (a reboot or a person's kill), nothing running, or the
 *  auto-lower setting off. Under 'floor' the agent cap stops at the owner's minimum. No `policy` given reads as 'on'.
 *  `effectiveWorkers` / `effectiveHeavy` are the caps in force (the person's value already lowered by any auto cap),
 *  so the new cap is never above an existing auto cap; one already as low is kept as it is. */
export function crashLowering(a: {
  clean: boolean
  signal: string | null
  health: HealthSnapshot | null
  workersAtCrash: number
  heavyAtCrash: number
  checksAtCrash: number
  effectiveWorkers: number
  effectiveHeavy: number
  now: string
  policy?: LowerPolicy
}): ((cur: AutoLimits) => AutoLimits) | null {
  const { mode, floor } = a.policy ?? { mode: 'on', floor: 1 }
  if (a.clean || mode === 'off') return null
  if (a.signal && a.health?.strained !== true) return null
  if (a.workersAtCrash === 0 && a.heavyAtCrash === 0 && a.checksAtCrash === 0) return null

  // About three quarters of what ran, at least one fewer.
  const proposed =
    a.workersAtCrash >= 2 ? Math.max(1, Math.min(a.effectiveWorkers, a.workersAtCrash) - Math.max(1, Math.ceil(a.workersAtCrash * 0.25))) : null
  const held = proposed === null ? null : clampLowering(mode, floor, proposed, a.effectiveWorkers)
  // Held at the floor, a cap that would not be lower than the one in force is no lowering.
  const workers = held !== null && (mode === 'on' || held < a.effectiveWorkers) ? held : null
  const heavy = a.heavyAtCrash >= 1 || a.effectiveHeavy > 1 ? Math.max(1, Math.min(a.effectiveHeavy, Math.max(a.heavyAtCrash, 1)) - 1) : null
  const checks = a.checksAtCrash >= 2 || a.heavyAtCrash >= 1
  if (workers === null && heavy === null && !checks) return null

  const how = a.signal ? `Host ended on ${a.signal} while the machine was strained` : 'Host ended without a clean exit'
  const ran = `${plural(a.workersAtCrash, 'agent', 'agents')}, ${plural(a.heavyAtCrash, 'heavy job', 'heavy jobs')} and ${plural(a.checksAtCrash, 'check', 'checks')} ran`
  const mem = a.health ? `; ${memoryText(a.health)}` : ''
  const detail = `${how} while ${ran}${mem}`

  return (cur) => {
    const next: AutoLimits = { ...cur, history: [...cur.history] }
    if (workers !== null && (cur.workers === undefined || workers < cur.workers.cap)) {
      next.workers = { cap: workers, cause: 'crash', at: a.now, detail }
      next.history.push({ at: a.now, what: 'workers', from: a.effectiveWorkers, to: workers, cause: 'crash', detail })
    }
    if (heavy !== null && (cur.heavy === undefined || heavy < cur.heavy.cap)) {
      next.heavy = { cap: heavy, cause: 'crash', at: a.now, detail }
      next.history.push({ at: a.now, what: 'heavy', from: a.effectiveHeavy, to: heavy, cause: 'crash', detail })
    }
    if (checks && cur.checksAsHeavy === undefined) {
      next.checksAsHeavy = { cause: 'crash', at: a.now }
      next.history.push({ at: a.now, what: 'checks', from: null, to: null, cause: 'crash', detail })
    }
    return next
  }
}

/** "agents 8 -> 6, heavy 2 -> 1, checks wait for heavy slots" from the history rows a lowering appended; null for none. */
function loweredOf(rows: AutoLimits['history']): string | null {
  const parts = rows.map((r) => (r.what === 'checks' ? 'checks wait for heavy slots' : `${r.what === 'workers' ? 'agents' : 'heavy'} ${r.from} -> ${r.to}`))
  return parts.length > 0 ? parts.join(', ') : null
}

export interface CrashLimitsDeps {
  profileDir: string
  /** orchestration.json as it was before anything loaded it. */
  state: OrchState | null
  /** The caps in force now (readMaxConcurrentWorkers / readHeavyJobsAtOnce). */
  effective(): Promise<{ workers: number; heavy: number }>
  /** The auto-lower setting and the owner's minimum; not given: read from app-settings.json. */
  policy?(): Promise<LowerPolicy>
  log(m: string): void
  activity(d: ActivityDraft): void
  now?(): Date
}

/** The auto-lower setting and the owner's minimum, from the profile's app-settings.json. */
async function lowerPolicyIn(profileDir: string): Promise<LowerPolicy> {
  const o = await readAppSettingsObject(path.join(profileDir, 'app-settings.json'))
  return lowerPolicyOf(o, maxConcurrentWorkersOf(o?.maxConcurrentWorkers) ?? machineSpecs().recommended)
}

/** Runs once at the Host's start, before any worker or session is resumed. Reads the clean-exit marker without taking
 *  it (the session restore takes it), takes the signal marker, and applies `crashLowering`. Logs one line either way
 *  and posts a feed line when it lowered something. Never rejects. */
export async function lowerLimitsAfterCrash(d: CrashLimitsDeps): Promise<AutoLimits | null> {
  try {
    const clean = existsSync(cleanExitFileIn(d.profileDir))
    const signal = await takeSignalExit(d.profileDir)
    const kind = clean ? 'a clean' : signal ? `a ${signal}` : 'a hard'
    const health = await readHealthSnapshot(d.profileDir)
    const now = (d.now ?? (() => new Date()))()
    const at = now.toISOString()
    const counts = countsAtCrash({ health, state: d.state, nowMs: now.getTime() })
    const eff = clean ? { workers: 0, heavy: 0 } : await d.effective()
    const policy = clean ? undefined : await (d.policy ?? (() => lowerPolicyIn(d.profileDir)))()
    const fn = crashLowering({
      clean,
      signal,
      health,
      workersAtCrash: counts.workers,
      heavyAtCrash: counts.heavy,
      checksAtCrash: counts.checks,
      effectiveWorkers: eff.workers,
      effectiveHeavy: eff.heavy,
      now: at,
      policy
    })
    let rows: AutoLimits['history'] = []
    const next = fn
      ? await updateAutoLimits(d.profileDir, (cur) => {
          const n = fn(cur)
          rows = n.history.slice(cur.history.length)
          return n
        })
      : null
    const lowered = loweredOf(rows)
    if (!lowered) {
      d.log(`start after ${kind} exit: limits unchanged`)
      return next
    }
    d.log(`start after ${kind} exit: lowered ${lowered}`)
    d.activity({ type: 'host.recovered', payload: { title: 'Astera', reason: `Astera lowered its limits after a crash: ${lowered}` } })
    return next
  } catch (err) {
    d.log(err instanceof AutoLimitsReadOnlyError ? 'auto-limits.json is read-only; limits unchanged' : `crash limits: could not lower the limits: ${String(err)}`)
    return null
  }
}
