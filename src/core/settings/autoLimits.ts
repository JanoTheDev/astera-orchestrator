// T1: auto-limits, the lower caps Astera sets itself after the machine lagged or crashed. Their own file, because
// app-settings.json has one writer (the app) and the Host writes these. Every effective read of the worker cap and the
// heavy-job slots takes the minimum of the person's value and the auto-limit (`effectiveCap`).
// Also the Host's health snapshot and signal-exit marker, which the next Host start reads to judge a crash.
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { withFileLock } from '../fileLock'
import { readFileRetrying, renameRetrying } from '../renameRetry'
import type { AutoLimit, AutoLimitCause, AutoLimits, HealthSnapshot } from '../types'

export type { AutoLimit, AutoLimitCause, AutoLimits, HealthSnapshot }

export const AUTO_LIMITS_FILE = 'auto-limits.json'
export const autoLimitsFileIn = (profileDir: string): string => path.join(profileDir, AUTO_LIMITS_FILE)

const HISTORY_MAX = 20
const CAUSES: readonly string[] = ['strain', 'crash', 'oom']
const HISTORY_CAUSES: readonly string[] = [...CAUSES, 'calm', 'reset']
const WHATS: readonly string[] = ['workers', 'heavy', 'checks']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const causeOf = (v: unknown): AutoLimitCause | null => (str(v) && CAUSES.includes(v) ? (v as AutoLimitCause) : null)

function autoLimitOf(v: unknown): AutoLimit | undefined {
  if (!isObj(v)) return undefined
  const cause = causeOf(v.cause)
  if (!cause || !num(v.cap) || !Number.isInteger(v.cap) || v.cap < 1 || !str(v.at)) return undefined
  return { cap: v.cap, cause, at: v.at, detail: str(v.detail) ? v.detail : '' }
}

/** Narrows anything (a hand edit, a torn write) to a valid object; invalid parts are dropped. Caps are whole numbers >= 1. */
export function autoLimitsOf(value: unknown): AutoLimits {
  const out: AutoLimits = { history: [] }
  if (!isObj(value)) return out
  const workers = autoLimitOf(value.workers)
  if (workers) out.workers = workers
  const heavy = autoLimitOf(value.heavy)
  if (heavy) out.heavy = heavy
  const c = value.checksAsHeavy
  if (isObj(c)) {
    const cause = causeOf(c.cause)
    if (cause && str(c.at)) out.checksAsHeavy = { cause, at: c.at }
  }
  if (Array.isArray(value.history)) {
    for (const h of value.history) {
      if (!isObj(h) || !str(h.at) || !str(h.what) || !WHATS.includes(h.what) || !str(h.cause) || !HISTORY_CAUSES.includes(h.cause)) continue
      const end = (x: unknown): number | null | undefined => (x === null ? null : num(x) ? x : undefined)
      const from = end(h.from)
      const to = end(h.to)
      if (from === undefined || to === undefined) continue
      out.history.push({
        at: h.at,
        what: h.what as AutoLimits['history'][number]['what'],
        from,
        to,
        cause: h.cause as AutoLimits['history'][number]['cause'],
        detail: str(h.detail) ? h.detail : ''
      })
    }
    out.history = out.history.slice(-HISTORY_MAX)
  }
  return out
}

/** The cap in force: the person's value, lowered by the auto-limit, never below 1. */
export function effectiveCap(personCap: number, auto: AutoLimit | undefined): number {
  return Math.max(1, auto ? Math.min(personCap, auto.cap) : personCap)
}

/** Clears every auto-limit and records one 'reset' row for each that was set. */
export function resetAutoLimits(cur: AutoLimits, at: string): AutoLimits {
  const rows: AutoLimits['history'] = []
  if (cur.workers) rows.push({ at, what: 'workers', from: cur.workers.cap, to: null, cause: 'reset', detail: 'Auto-limits were reset.' })
  if (cur.heavy) rows.push({ at, what: 'heavy', from: cur.heavy.cap, to: null, cause: 'reset', detail: 'Auto-limits were reset.' })
  if (cur.checksAsHeavy) rows.push({ at, what: 'checks', from: null, to: null, cause: 'reset', detail: 'Auto-limits were reset.' })
  return { history: [...cur.history, ...rows].slice(-HISTORY_MAX) }
}

/** Never throws: a missing or unreadable file is no auto-limits. */
export async function readAutoLimits(profileDir: string): Promise<AutoLimits> {
  try {
    return autoLimitsOf(JSON.parse(await readFileRetrying(autoLimitsFileIn(profileDir))))
  } catch {
    return { history: [] }
  }
}

/** Sync read of the same file, for the app's synchronous cap getters. Never throws. */
export function readAutoLimitsSync(profileDir: string): AutoLimits {
  try {
    return autoLimitsOf(JSON.parse(readFileSync(autoLimitsFileIn(profileDir), 'utf8')))
  } catch {
    return { history: [] }
  }
}

export async function readChecksAsHeavy(profileDir: string): Promise<boolean> {
  return (await readAutoLimits(profileDir)).checksAsHeavy !== undefined
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

/** Read-modify-write under a lock, because the Host and the app both write. The result is narrowed and its history trimmed to 20. */
export async function updateAutoLimits(profileDir: string, fn: (cur: AutoLimits) => AutoLimits): Promise<AutoLimits> {
  return withFileLock(path.join(profileDir, 'auto-limits.lock'), async () => {
    const next = autoLimitsOf(fn(await readAutoLimits(profileDir)))
    ensureDir(profileDir)
    const file = autoLimitsFileIn(profileDir)
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    await renameRetrying(tmp, file)
    return next
  })
}

// --- Health snapshot and signal-exit marker (written by the Host, read by the next Host start) ---

export const healthFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'health.json')
export const signalExitFileIn = (profileDir: string): string => path.join(profileDir, 'host', 'signal-exit')

export function healthSnapshotOf(value: unknown): HealthSnapshot | null {
  if (!isObj(value) || !str(value.at) || typeof value.strained !== 'boolean') return null
  const { memAvailablePct, load1PerCpu, loopDelayP99Ms, liveWorkers, liveSessions, heavyRunning, checksRunning } = value
  if (![memAvailablePct, load1PerCpu, loopDelayP99Ms, liveWorkers, liveSessions, heavyRunning, checksRunning].every(num)) return null
  return {
    at: value.at,
    memAvailablePct: memAvailablePct as number,
    load1PerCpu: load1PerCpu as number,
    loopDelayP99Ms: loopDelayP99Ms as number,
    strained: value.strained,
    liveWorkers: liveWorkers as number,
    liveSessions: liveSessions as number,
    heavyRunning: heavyRunning as number,
    checksRunning: checksRunning as number
  }
}

/** Atomic (tmp + rename), mode 600. Sync: the Host writes it from a timer and from its exit handler. Never throws. */
function writeOwnerOnlySync(file: string, text: string): void {
  try {
    ensureDir(path.dirname(file))
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, text, { mode: 0o600 })
    renameSync(tmp, file)
  } catch {
    /* a missing snapshot only means the next start judges less */
  }
}

export function writeHealthSnapshotSync(profileDir: string, s: HealthSnapshot): void {
  writeOwnerOnlySync(healthFileIn(profileDir), JSON.stringify(s))
}

export async function readHealthSnapshot(profileDir: string): Promise<HealthSnapshot | null> {
  try {
    return healthSnapshotOf(JSON.parse(await readFileRetrying(healthFileIn(profileDir))))
  } catch {
    return null
  }
}

/** Written when the Host leaves on SIGTERM/SIGINT: the next start tells a reboot or kill from a hard death. */
export function writeSignalExitSync(profileDir: string, signal: string): void {
  writeOwnerOnlySync(signalExitFileIn(profileDir), signal)
}

/** Reads and removes the marker; null when absent. */
export async function takeSignalExit(profileDir: string): Promise<string | null> {
  const file = signalExitFileIn(profileDir)
  try {
    const text = (await fsp.readFile(file, 'utf8')).trim()
    return text || null
  } catch {
    return null
  } finally {
    try {
      unlinkSync(file)
    } catch {
      /* absent */
    }
  }
}
