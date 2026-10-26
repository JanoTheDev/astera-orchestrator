// T3: the Host's load monitor. Every 10 s it samples free memory, load per CPU and the Host's own event-loop delay,
// writes the health snapshot, and on sustained strain lowers the auto-limits (core/settings/autoLimits.ts) so no new
// agent, heavy job or check starts; after 20 calm minutes it raises its own lowerings back one step at a time. Every
// scheduler read takes min(person's value, auto-limit) per call, so writing the file is all it takes. It never touches a
// running session. `judge` and the readings maths are pure; the sampler is the only part that reads or writes.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { effectiveCap, readAutoLimits, updateAutoLimits, writeHealthSnapshotSync, type AutoLimits } from '../core/settings/autoLimits'
import { HEAVY_JOBS_DEFAULT, heavyJobsAtOnceOf } from '../core/settings/heavyJobs'
import { machineSpecs } from '../core/settings/machineSpecs'
import { maxConcurrentWorkersOf } from '../core/settings/maxConcurrentWorkers'
import { readAppSettingsObject } from '../core/settings/settingsObject'
import type { ActivityDraft } from '../core/orchestration/activity'

export const SAMPLE_MS = 10_000
/** 20 minutes of samples. */
export const SAMPLES_KEPT = 120
export const CALM_MS = 20 * 60_000
export const LOWER_COOLDOWN_MS = 2 * 60_000

export interface Sample {
  /** ms since the epoch */
  at: number
  /** Available memory, % of total */
  memAvailablePct: number
  /** 1-minute load / logical CPUs; 0 where the OS has no load average (Windows) */
  load1PerCpu: number
  loopDelayP99Ms: number
}

export interface LiveCounts {
  /** Worker sessions against the cap (workersAgainstCap) */
  workers: number
  heavyRunning: number
  checksRunning: number
}

export interface Caps {
  workers: number
  heavy: number
}

export const isStrained = (s: Sample): boolean => s.memAvailablePct < 10 || s.loopDelayP99Ms > 1000 || s.load1PerCpu > 3
export const isCritical = (s: Sample): boolean => s.memAvailablePct < 5

// ── Readings ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the OS said at one moment. The sampler reads it; `sampleOf` turns it into a Sample. */
export interface Readings {
  memAvailablePct: number
  /** os.loadavg()[0] */
  load1: number
  cpus: number
  /** The event-loop delay histogram's p99 since the last sample, in ns */
  loopDelayP99Ns: number
}

export function sampleOf(r: Readings, at: number): Sample {
  const pct = (x: number): number => (Number.isFinite(x) ? x : 0)
  return {
    at,
    memAvailablePct: pct(r.memAvailablePct),
    load1PerCpu: r.cpus > 0 ? pct(r.load1 / r.cpus) : 0,
    loopDelayP99Ms: pct(r.loopDelayP99Ns / 1e6)
  }
}

/** MemAvailable as a % of MemTotal from /proc/meminfo; null when either line is missing. os.freemem() is MemFree on
 *  older Node, which counts the page cache as used and would read a healthy machine as strained. */
export function memAvailablePctOfMeminfo(text: string): number | null {
  const kb = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }
  const total = kb('MemTotal')
  const avail = kb('MemAvailable')
  return total && avail !== null ? (avail / total) * 100 : null
}

function memAvailablePct(): number {
  if (process.platform === 'linux') {
    try {
      const p = memAvailablePctOfMeminfo(readFileSync('/proc/meminfo', 'utf8'))
      if (p !== null) return p
    } catch {
      /* falls back to os below */
    }
  }
  return (os.freemem() / os.totalmem()) * 100
}

// ── The judge ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Update = (cur: AutoLimits) => AutoLimits

/** One English line for the log, the Settings explanation and the feed: what was seen on the latest sample. */
function seenLine(s: Sample, liveWorkers: number): string {
  const parts: string[] = []
  if (s.memAvailablePct < 10) parts.push(`memory ${Math.round(s.memAvailablePct)}% free`)
  if (s.loopDelayP99Ms > 1000) parts.push(`Host loop ${(s.loopDelayP99Ms / 1000).toFixed(1)} s behind`)
  if (s.load1PerCpu > 3) parts.push(`load ${s.load1PerCpu.toFixed(1)} per CPU`)
  const seen = parts.join(', ')
  return liveWorkers >= 1 ? `${seen} while ${liveWorkers} agent${liveWorkers === 1 ? '' : 's'} ran` : seen
}

const lastAtOf = (cur: AutoLimits, causes?: readonly string[]): number =>
  cur.history.reduce((t, h) => (!causes || causes.includes(h.cause) ? Math.max(t, Date.parse(h.at) || 0) : t), 0)

/**
 * What to do with the limits after this sample, or null for nothing. Pure.
 * - Lower: the last 3 samples strained or the last 2 critical, and no lowering in the last 2 minutes. Workers go to one
 *   below the agents running now (never below 1, and only when that is lower than the cap in force), heavy jobs one
 *   below their cap, and checks wait for a heavy slot.
 * - Raise: only what this monitor lowered (cause 'strain'), one step, when 20 minutes passed with no strained sample and
 *   no change. A cap that reaches the person's own value is removed. 'crash' and 'oom' lowerings stay for the person.
 * `effective` is the cap in force (person's value lowered by the auto-limit), `person` the value without it.
 */
export function judge(samples: readonly Sample[], cur: AutoLimits, live: LiveCounts, effective: Caps, person: Caps, now: number): Update | null {
  const latest = samples[samples.length - 1]
  if (!latest) return null
  const last3 = samples.slice(-3)
  const last2 = samples.slice(-2)
  const strain = (last3.length === 3 && last3.every(isStrained)) || (last2.length === 2 && last2.every(isCritical))
  if (strain) return lowering(latest, cur, live, effective, now)
  return raising(samples, cur, person, now)
}

function lowering(latest: Sample, cur: AutoLimits, live: LiveCounts, effective: Caps, now: number): Update | null {
  if (now - lastAtOf(cur, ['strain', 'crash', 'oom']) < LOWER_COOLDOWN_MS) return null
  const workers = live.workers >= 1 ? Math.max(1, Math.min(effective.workers, live.workers) - 1) : null
  const lowerWorkers = workers !== null && workers < effective.workers
  const heavy = Math.max(1, effective.heavy - 1)
  const lowerHeavy = heavy < effective.heavy
  const lowerChecks = cur.checksAsHeavy === undefined
  if (!lowerWorkers && !lowerHeavy && !lowerChecks) return null
  const detail = seenLine(latest, live.workers)
  const at = new Date(now).toISOString()
  return (c) => {
    const next: AutoLimits = { ...c, history: [...c.history] }
    // A cap a crash or an OOM set keeps its cause, so it is still the person's to restore.
    if (lowerWorkers) {
      next.workers = { cap: workers, cause: c.workers?.cause ?? 'strain', at, detail }
      next.history.push({ at, what: 'workers', from: effective.workers, to: workers, cause: 'strain', detail })
    }
    if (lowerHeavy) {
      next.heavy = { cap: heavy, cause: c.heavy?.cause ?? 'strain', at, detail }
      next.history.push({ at, what: 'heavy', from: effective.heavy, to: heavy, cause: 'strain', detail })
    }
    if (lowerChecks && !c.checksAsHeavy) {
      next.checksAsHeavy = { cause: 'strain', at }
      next.history.push({ at, what: 'checks', from: null, to: null, cause: 'strain', detail })
    }
    return next
  }
}

function raising(samples: readonly Sample[], cur: AutoLimits, person: Caps, now: number): Update | null {
  const ours = (c: { cause: string } | undefined): boolean => c?.cause === 'strain'
  if (!ours(cur.workers) && !ours(cur.heavy) && !ours(cur.checksAsHeavy)) return null
  // Calm needs 20 minutes of watching: a Host that has run for less knows nothing about the minutes before it.
  if (now - samples[0].at < CALM_MS - 2 * SAMPLE_MS) return null
  if (samples.some((s) => s.at >= now - CALM_MS && isStrained(s))) return null
  if (now - lastAtOf(cur) <= CALM_MS) return null
  const at = new Date(now).toISOString()
  const detail = 'The machine was calm for 20 minutes.'
  return (c) => {
    const next: AutoLimits = { ...c, history: [...c.history] }
    const step = (what: 'workers' | 'heavy', limit: AutoLimits['workers'], own: number): void => {
      if (!limit || limit.cause !== 'strain') return
      const to = Math.min(limit.cap + 1, own)
      if (to >= own) delete next[what]
      else next[what] = { ...limit, cap: to, at }
      next.history.push({ at, what, from: limit.cap, to, cause: 'calm', detail })
    }
    step('workers', c.workers, person.workers)
    step('heavy', c.heavy, person.heavy)
    if (c.checksAsHeavy?.cause === 'strain') {
      delete next.checksAsHeavy
      next.history.push({ at, what: 'checks', from: null, to: null, cause: 'calm', detail })
    }
    return next
  }
}

/** The log line and the feed line for the history rows one update added. */
export function changeLines(rows: AutoLimits['history']): { log: string; feed: string } | null {
  if (rows.length === 0) return null
  const calm = rows[0].cause === 'calm'
  const parts = rows.map((r) => {
    if (r.what === 'checks') return calm ? 'checks run as before' : 'checks wait for a heavy slot'
    const name = r.what === 'workers' ? 'agents' : 'heavy jobs'
    return calm ? `${name} back to ${r.to}` : `${name} ${r.from} -> ${r.to}`
  })
  const log = `load monitor: ${calm ? 'raised' : 'lowered'} ${parts.join(', ')} (${rows[0].detail})`
  const feed = calm
    ? `Machine calm again: ${parts.join(', ')}`
    : `Astera holds back new agents: ${parts.join(', ')} while ${rows[0].detail}. Running agents carry on.`
  return { log, feed }
}

// ── The sampler ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LoadMonitorDeps {
  profileDir: string
  /** Counts at this moment: `workers` and `checks` from the orchestration state, `sessions` every live agent session,
   *  `heavyTickets` the live tickets in the heavy queue (the first N hold the slots). */
  live(): { workers: number; sessions: number; heavyTickets: number; checks: number }
  activity(d: ActivityDraft): void
  log(m: string): void
  /** Tests inject the OS and the clock. */
  readings?: () => Readings
  nowMs?: () => number
}

export interface LoadMonitor {
  start(): void
  stop(): void
  /** One sample, judged. Never rejects. */
  tick(): Promise<void>
}

/** The person's own caps, without any auto-limit. */
async function personCaps(settingsFile: string): Promise<Caps> {
  const o = await readAppSettingsObject(settingsFile)
  return { workers: maxConcurrentWorkersOf(o?.maxConcurrentWorkers) ?? machineSpecs().recommended, heavy: heavyJobsAtOnceOf(o?.heavyJobsAtOnce) ?? HEAVY_JOBS_DEFAULT }
}

export function createLoadMonitor(d: LoadMonitorDeps): LoadMonitor {
  const now = d.nowMs ?? Date.now
  const settingsFile = path.join(d.profileDir, 'app-settings.json')
  const histogram = d.readings ? null : monitorEventLoopDelay({ resolution: 20 })
  const readings =
    d.readings ??
    ((): Readings => {
      const r = { memAvailablePct: memAvailablePct(), load1: os.loadavg()[0], cpus: os.availableParallelism?.() ?? os.cpus().length, loopDelayP99Ns: histogram!.percentile(99) }
      histogram!.reset()
      return r
    })
  const samples: Sample[] = []
  let timer: NodeJS.Timeout | null = null
  let busy = false

  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const at = now()
      const sample = sampleOf(readings(), at)
      samples.push(sample)
      if (samples.length > SAMPLES_KEPT) samples.shift()
      const cur = await readAutoLimits(d.profileDir)
      let person: Caps | null = null
      try {
        person = await personCaps(settingsFile)
      } catch {
        /* an unreadable settings file: the snapshot is still written, nothing is judged */
      }
      const effective = person && { workers: effectiveCap(person.workers, cur.workers), heavy: effectiveCap(person.heavy, cur.heavy) }
      const l = d.live()
      const live: LiveCounts = { workers: l.workers, heavyRunning: Math.min(l.heavyTickets, effective?.heavy ?? l.heavyTickets), checksRunning: l.checks }
      writeHealthSnapshotSync(d.profileDir, {
        at: new Date(at).toISOString(),
        memAvailablePct: sample.memAvailablePct,
        load1PerCpu: sample.load1PerCpu,
        loopDelayP99Ms: sample.loopDelayP99Ms,
        strained: isStrained(sample),
        liveWorkers: live.workers,
        liveSessions: l.sessions,
        heavyRunning: live.heavyRunning,
        checksRunning: live.checksRunning
      })
      if (!person || !effective) return
      const update = judge(samples, cur, live, effective, person, at)
      if (!update) return
      const iso = new Date(at).toISOString()
      const after = await updateAutoLimits(d.profileDir, update)
      const lines = changeLines(after.history.filter((h) => h.at === iso && h.cause !== 'reset'))
      if (!lines) return
      d.log(lines.log)
      d.activity({ type: 'host.recovered', payload: { title: 'Astera', reason: lines.feed } })
    } catch (err) {
      d.log(`load monitor: ${String(err)}`)
    } finally {
      busy = false
    }
  }

  return {
    tick,
    start() {
      if (timer) return
      histogram?.enable()
      timer = setInterval(() => void tick(), SAMPLE_MS)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      histogram?.disable()
    }
  }
}
