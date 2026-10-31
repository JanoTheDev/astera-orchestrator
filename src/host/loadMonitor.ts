// T3: the Host's load monitor. Every 10 s it samples free memory (and on Windows the commit headroom), load per CPU and
// the Host's own event-loop delay, writes the health snapshot, and on sustained strain lowers the auto-limits
// (core/settings/autoLimits.ts) in stages: first it pauses new starts and tightens the heavy slots, then it lowers the
// agent cap two at a time down to a floor (minWorkersUnderPressure). After 3 calm minutes it raises its own lowerings
// back, several steps at a time. Every scheduler read takes min(person's value, auto-limit) per call, so writing the
// file is all it takes. It never touches a running session. `judge` and the readings maths are pure; the sampler and
// the commit reader are the only parts that read or write.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { effectiveCap, readAutoLimits, updateAutoLimits, writeHealthSnapshotSync, type AutoLimits, type HealthSnapshot } from '../core/settings/autoLimits'
import { HEAVY_JOBS_DEFAULT, heavyJobsAtOnceOf } from '../core/settings/heavyJobs'
import { machineSpecs } from '../core/settings/machineSpecs'
import { maxConcurrentWorkersOf } from '../core/settings/maxConcurrentWorkers'
import { minWorkersFloor, minWorkersUnderPressureOf } from '../core/settings/minWorkersUnderPressure'
import { readAppSettingsObject } from '../core/settings/settingsObject'
import type { ActivityDraft } from '../core/orchestration/activity'

export const SAMPLE_MS = 10_000
/** 5 minutes of samples: more than the 3 calm minutes a raise looks back on. */
export const SAMPLES_KEPT = 30
/** No strained sample and no change for this long raises the monitor's own lowerings. */
export const CALM_RAISE_MS = 3 * 60_000
/** Between two lowering stages, unless the strain is critical. */
export const LOWER_COOLDOWN_MS = 2 * 60_000
/** Agents taken off the cap per lowering stage, and the most given back per calm raise. */
export const LOWER_WORKERS_STEP = 2
export const RAISE_WORKERS_STEPS = 4
export const MEM_STRAINED_PCT = 10
export const MEM_CRITICAL_PCT = 5
/** Windows commit headroom thresholds. Allocations fail when the commit charge reaches the commit limit, which can
 *  happen while physical memory still looks free. A measuring Task may tune these. */
export const COMMIT_STRAINED_PCT = 10
export const COMMIT_CRITICAL_PCT = 5
/** How often the Windows commit reader asks, and how old its last answer may be before it reads as unknown. */
export const COMMIT_READ_MS = 30_000
export const COMMIT_STALE_MS = 3 * COMMIT_READ_MS

export interface Sample {
  /** ms since the epoch */
  at: number
  /** Available memory, % of total; null when the OS gave no usable reading (unknown is not strain) */
  memAvailablePct: number | null
  /** Windows: 100 * (commit limit - committed) / commit limit; null or absent when unknown or not Windows */
  commitHeadroomPct?: number | null
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

/** The person's own caps, and the floor the agent cap is never lowered below. */
export interface PersonCaps extends Caps {
  /** minWorkersFloor(workers, setting); not given: half the person's limit, rounded up. */
  workersFloor?: number
}

const memLow = (s: Sample, pct: number): boolean => s.memAvailablePct !== null && s.memAvailablePct < pct
const commitLow = (s: Sample, pct: number): boolean => typeof s.commitHeadroomPct === 'number' && s.commitHeadroomPct < pct

export const isStrained = (s: Sample): boolean =>
  memLow(s, MEM_STRAINED_PCT) || commitLow(s, COMMIT_STRAINED_PCT) || s.loopDelayP99Ms > 1000 || s.load1PerCpu > 3
export const isCritical = (s: Sample): boolean => memLow(s, MEM_CRITICAL_PCT) || commitLow(s, COMMIT_CRITICAL_PCT)

// ── Readings ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the OS said at one moment. The sampler reads it; `sampleOf` turns it into a Sample. */
export interface Readings {
  /** NaN when the OS gave nothing usable */
  memAvailablePct: number
  /** Windows commit headroom %; null or absent when unknown or not Windows */
  commitHeadroomPct?: number | null
  /** os.loadavg()[0] */
  load1: number
  cpus: number
  /** The event-loop delay histogram's p99 since the last sample, in ns */
  loopDelayP99Ns: number
}

/** A non-finite memory or commit reading is unknown (null), never 0% free: 0% would read as critical. A non-finite load
 *  or loop delay reads as 0, which is never strain either. */
export function sampleOf(r: Readings, at: number): Sample {
  const orZero = (x: number): number => (Number.isFinite(x) ? x : 0)
  const pctOrNull = (x: number | null | undefined): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : null
  return {
    at,
    memAvailablePct: pctOrNull(r.memAvailablePct),
    commitHeadroomPct: pctOrNull(r.commitHeadroomPct),
    load1PerCpu: r.cpus > 0 ? orZero(r.load1 / r.cpus) : 0,
    loopDelayP99Ms: orZero(r.loopDelayP99Ns / 1e6)
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

/** Physical memory available, % of total; NaN when unknown. On Windows os.freemem() is ullAvailPhys, which counts
 *  standby pages as available, so physical availability reads right there; the commit charge is read separately. */
function memAvailablePct(platform: NodeJS.Platform): number {
  if (platform === 'linux') {
    try {
      const p = memAvailablePctOfMeminfo(readFileSync('/proc/meminfo', 'utf8'))
      if (p !== null) return p
    } catch {
      /* falls back to os below */
    }
  }
  const total = os.totalmem()
  return total > 0 ? (os.freemem() / total) * 100 : NaN
}

/** One line of the commit reader: "<FreeVirtualMemory KB> <TotalVirtualMemorySize KB>" from Win32_OperatingSystem, that
 *  is the commit limit minus the commit charge, and the commit limit. Headroom %, or null for anything else. */
export function commitHeadroomPctOf(line: string): number | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
  if (!m) return null
  const free = Number(m[1])
  const limit = Number(m[2])
  if (!(limit > 0) || !Number.isFinite(free)) return null
  return (100 * Math.min(free, limit)) / limit
}

/** The PowerShell loop the commit reader runs: one CIM query every 30 s, so a sample costs no process start. It leaves
 *  when the Host that started it is gone or its stdout closes. Win32_OperatingSystem's property names are not
 *  localised, unlike the performance counter names typeperf takes. */
export function commitReaderScript(parentPid: number, everyMs: number = COMMIT_READ_MS): string {
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `while ($true) {`,
    `if (-not (Get-Process -Id ${Math.floor(parentPid)})) { exit }`,
    `$o = Get-CimInstance -ClassName Win32_OperatingSystem -Property FreeVirtualMemory,TotalVirtualMemorySize`,
    `try { [Console]::Out.WriteLine("$($o.FreeVirtualMemory) $($o.TotalVirtualMemorySize)"); [Console]::Out.Flush() } catch { exit }`,
    `Start-Sleep -Milliseconds ${Math.max(1000, Math.round(everyMs))}`,
    `}`
  ].join('\n')
}

/** powershell -EncodedCommand takes the script as base64 UTF-16LE: no quoting of a multi-line script on a command line. */
export const encodedCommand = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

export interface CommitReader {
  /** The last headroom read, or null when unknown (not Windows, not read yet, unreadable, or older than COMMIT_STALE_MS). */
  latest(): number | null
  stop(): void
}

export type CommitSpawn = (file: string, args: string[], opts: { windowsHide: true; stdio: ['ignore', 'pipe', 'ignore'] }) => ChildProcess

export interface CommitReaderDeps {
  platform?: NodeJS.Platform
  spawn?: CommitSpawn
  nowMs?: () => number
  parentPid?: number
  /** A reader that exited is started again on a later ask, at most this often. */
  restartMs?: number
}

/** The Windows commit-headroom reader: one long-lived, hidden PowerShell that prints a reading every 30 s, started on
 *  the first ask. Elsewhere it spawns nothing and always answers null. */
export function createCommitReader(d: CommitReaderDeps = {}): CommitReader {
  const platform = d.platform ?? process.platform
  const now = d.nowMs ?? Date.now
  const spawn: CommitSpawn = d.spawn ?? ((file, args, opts) => nodeSpawn(file, args, opts))
  const restartMs = d.restartMs ?? 5 * 60_000
  let child: ChildProcess | null = null
  let startedAt = -Infinity
  let value: { pct: number; at: number } | null = null

  const start = (): void => {
    startedAt = now()
    let c: ChildProcess
    try {
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand(commitReaderScript(d.parentPid ?? process.pid))], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      return
    }
    child = c
    let buf = ''
    c.stdout?.on('data', (chunk: string | Buffer) => {
      buf += String(chunk)
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const pct = commitHeadroomPctOf(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (pct !== null) value = { pct, at: now() }
      }
      if (buf.length > 4096) buf = ''
    })
    const gone = (): void => {
      if (child === c) child = null
    }
    c.on('error', gone)
    c.on('exit', gone)
    // The Host may leave without stop(): the child must not hold it open, and it leaves on its own (parent pid check).
    c.unref?.()
    ;(c.stdout as { unref?: () => void } | null)?.unref?.()
  }

  return {
    latest() {
      if (platform !== 'win32') return null
      if (!child && now() - startedAt >= restartMs) start()
      return value && now() - value.at <= COMMIT_STALE_MS ? value.pct : null
    },
    stop() {
      const c = child
      child = null
      try {
        c?.kill()
      } catch {
        /* already gone */
      }
    }
  }
}

// ── The judge ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Which stage an update is: 'pause' (new starts held at the agents running, heavy slots tightened), 'lower' (agents
 *  down by LOWER_WORKERS_STEP towards the floor) or 'raise' (calm). */
export type Stage = 'pause' | 'lower' | 'raise'
export type Update = ((cur: AutoLimits) => AutoLimits) & { stage: Stage; floor?: number }

/** One English line for the log, the Settings explanation and the feed: what was seen on the latest sample. */
function seenLine(s: Sample, liveWorkers: number): string {
  const parts: string[] = []
  if (memLow(s, MEM_STRAINED_PCT)) parts.push(`memory ${Math.round(s.memAvailablePct!)}% free`)
  if (commitLow(s, COMMIT_STRAINED_PCT)) parts.push(`commit headroom ${Math.round(s.commitHeadroomPct!)}%`)
  if (s.loopDelayP99Ms > 1000) parts.push(`Host loop ${(s.loopDelayP99Ms / 1000).toFixed(1)} s behind`)
  if (s.load1PerCpu > 3) parts.push(`load ${s.load1PerCpu.toFixed(1)} per CPU`)
  const seen = parts.join(', ')
  return liveWorkers >= 1 ? `${seen} while ${liveWorkers} agent${liveWorkers === 1 ? '' : 's'} ran` : seen
}

const lastAtOf = (cur: AutoLimits, causes?: readonly string[]): number =>
  cur.history.reduce((t, h) => (!causes || causes.includes(h.cause) ? Math.max(t, Date.parse(h.at) || 0) : t), 0)

/** A strain episode is open when the monitor's latest own row (strain, calm or reset) is a lowering: the next stage
 *  lowers further instead of pausing again. */
function inEpisode(cur: AutoLimits): boolean {
  for (let i = cur.history.length - 1; i >= 0; i--) {
    const c = cur.history[i].cause
    if (c === 'strain') return true
    if (c === 'calm' || c === 'reset') return false
  }
  return false
}

const withStage = (fn: (cur: AutoLimits) => AutoLimits, stage: Stage, floor?: number): Update =>
  Object.assign(fn, floor === undefined ? { stage } : { stage, floor })

/**
 * What to do with the limits after this sample, or null for nothing. Pure.
 * - Strain is the last 3 samples strained, or the last 2 critical. Each stage waits LOWER_COOLDOWN_MS after the last
 *   lowering; critical strain skips that wait, but never the floor.
 *   1. 'pause', the first stage of an episode: the agent cap goes to the agents running now when that is below the cap
 *      in force (nothing running is stopped), heavy slots one down (never below 1), checks wait for a heavy slot.
 *   2. 'lower', while the strain stays: the agent cap two down from the cap in force, never below the floor
 *      (minWorkersUnderPressure, half the person's limit by default); heavy slots one more down.
 *   A pause that would change nothing moves straight on to 'lower'.
 * - Raise: only what this monitor lowered (cause 'strain'), when 3 minutes passed with no strained sample and no change:
 *   agents up by RAISE_WORKERS_STEPS, heavy slots by one, and the checks-wait lifted. A cap that reaches the person's
 *   own value is removed. 'crash' and 'oom' lowerings stay for the person.
 * `effective` is the cap in force (person's value lowered by the auto-limit), `person` the value without it.
 */
export function judge(samples: readonly Sample[], cur: AutoLimits, live: LiveCounts, effective: Caps, person: PersonCaps, now: number): Update | null {
  const latest = samples[samples.length - 1]
  if (!latest) return null
  const last3 = samples.slice(-3)
  const last2 = samples.slice(-2)
  const critical = last2.length === 2 && last2.every(isCritical)
  const strain = (last3.length === 3 && last3.every(isStrained)) || critical
  if (strain) return lowering(latest, cur, live, effective, person.workersFloor ?? minWorkersFloor(person.workers, null), critical, now)
  return raising(samples, cur, person, now)
}

interface Plan {
  stage: 'pause' | 'lower'
  workers: number | null
  heavy: number | null
  checks: boolean
}

function lowering(latest: Sample, cur: AutoLimits, live: LiveCounts, effective: Caps, floor: number, critical: boolean, now: number): Update | null {
  if (!critical && now - lastAtOf(cur, ['strain', 'crash', 'oom']) < LOWER_COOLDOWN_MS) return null
  const heavy = effective.heavy > 1 ? effective.heavy - 1 : null
  const checks = cur.checksAsHeavy === undefined
  const pause: Plan = { stage: 'pause', workers: live.workers >= 1 && live.workers < effective.workers ? live.workers : null, heavy, checks }
  const stepTo = Math.max(floor, effective.workers - LOWER_WORKERS_STEP)
  const step: Plan = { stage: 'lower', workers: stepTo < effective.workers ? stepTo : null, heavy, checks }
  const changes = (p: Plan): boolean => p.workers !== null || p.heavy !== null || p.checks
  const plan = !inEpisode(cur) && changes(pause) ? pause : changes(step) ? step : null
  if (!plan) return null
  const detail = seenLine(latest, live.workers)
  const at = new Date(now).toISOString()
  return withStage(
    (c) => {
      const next: AutoLimits = { ...c, history: [...c.history] }
      // A cap a crash or an OOM set keeps its cause, so it is still the person's to restore.
      if (plan.workers !== null) {
        next.workers = { cap: plan.workers, cause: c.workers?.cause ?? 'strain', at, detail }
        next.history.push({ at, what: 'workers', from: effective.workers, to: plan.workers, cause: 'strain', detail })
      }
      if (plan.heavy !== null) {
        next.heavy = { cap: plan.heavy, cause: c.heavy?.cause ?? 'strain', at, detail }
        next.history.push({ at, what: 'heavy', from: effective.heavy, to: plan.heavy, cause: 'strain', detail })
      }
      if (plan.checks && !c.checksAsHeavy) {
        next.checksAsHeavy = { cause: 'strain', at }
        next.history.push({ at, what: 'checks', from: null, to: null, cause: 'strain', detail })
      }
      return next
    },
    plan.stage,
    floor
  )
}

function raising(samples: readonly Sample[], cur: AutoLimits, person: Caps, now: number): Update | null {
  const ours = (c: { cause: string } | undefined): boolean => c?.cause === 'strain'
  if (!ours(cur.workers) && !ours(cur.heavy) && !ours(cur.checksAsHeavy)) return null
  // Calm needs 3 minutes of watching: a Host that has run for less knows nothing about the minutes before it.
  if (now - samples[0].at < CALM_RAISE_MS) return null
  if (samples.some((s) => s.at >= now - CALM_RAISE_MS && isStrained(s))) return null
  if (now - lastAtOf(cur) < CALM_RAISE_MS) return null
  const at = new Date(now).toISOString()
  const detail = 'The machine was calm for 3 minutes.'
  return withStage((c) => {
    const next: AutoLimits = { ...c, history: [...c.history] }
    const step = (what: 'workers' | 'heavy', limit: AutoLimits['workers'], own: number, by: number): void => {
      if (!limit || limit.cause !== 'strain') return
      const to = Math.min(limit.cap + by, own)
      if (to >= own) delete next[what]
      else next[what] = { ...limit, cap: to, at }
      next.history.push({ at, what, from: limit.cap, to, cause: 'calm', detail })
    }
    step('workers', c.workers, person.workers, RAISE_WORKERS_STEPS)
    step('heavy', c.heavy, person.heavy, 1)
    if (c.checksAsHeavy?.cause === 'strain') {
      delete next.checksAsHeavy
      next.history.push({ at, what: 'checks', from: null, to: null, cause: 'calm', detail })
    }
    return next
  }, 'raise')
}

/** The log line and the feed line for the history rows one update added. `info` names the stage (and the floor) the
 *  update came from; without it a lowering is worded as the 'lower' stage. */
export function changeLines(rows: AutoLimits['history'], info: { stage?: Stage; floor?: number } = {}): { log: string; feed: string } | null {
  if (rows.length === 0) return null
  const detail = rows[0].detail
  if (rows[0].cause === 'calm') {
    const parts = rows.map((r) => (r.what === 'checks' ? 'checks run as before' : `${r.what === 'workers' ? 'agents' : 'heavy jobs'} back to ${r.to}`))
    return { log: `load monitor: raised ${parts.join(', ')} (${detail})`, feed: `Machine calm again: ${parts.join(', ')}` }
  }
  const workers = rows.find((r) => r.what === 'workers')
  const others = rows
    .filter((r) => r.what !== 'workers')
    .map((r) => (r.what === 'checks' ? 'checks wait for a heavy slot' : `heavy jobs ${r.from} -> ${r.to}`))
  if (info.stage === 'pause') {
    const head = `paused new agents${workers ? ` (cap ${workers.from} -> ${workers.to})` : ''}`
    return {
      log: `load monitor: ${[head, ...others].join(', ')} (${detail})`,
      feed: `Astera ${head}${others.length ? ` and ${others.join(', ')}` : ''} while ${detail}; running agents carry on.`
    }
  }
  const floor = info.floor !== undefined ? ` (floor ${info.floor})` : ''
  const parts = [...(workers ? [`agents ${workers.from} -> ${workers.to}${floor}`] : []), ...others]
  return {
    log: `load monitor: lowered ${parts.join(', ')} (${detail})`,
    feed: `Astera lowered ${parts.join(', ')} while ${detail}; running agents carry on.`
  }
}

// ── The sampler ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LoadMonitorDeps {
  profileDir: string
  /** Counts at this moment: `workers` and `checks` from the orchestration state, `sessions` every live agent session,
   *  `heavyTickets` the live tickets in the heavy queue (the first N hold the slots). */
  live(): { workers: number; sessions: number; heavyTickets: number; checks: number }
  activity(d: ActivityDraft): void
  log(m: string): void
  /** Tests inject the OS, the platform and the clock. Injected readings replace every OS read, the commit reader too. */
  readings?: () => Readings
  platform?: NodeJS.Platform
  nowMs?: () => number
}

export interface LoadMonitor {
  start(): void
  stop(): void
  /** One sample, judged. Never rejects. */
  tick(): Promise<void>
}

/** The person's own caps, without any auto-limit, and the floor under strain. */
async function personCaps(settingsFile: string): Promise<Required<PersonCaps>> {
  const o = await readAppSettingsObject(settingsFile)
  const workers = maxConcurrentWorkersOf(o?.maxConcurrentWorkers) ?? machineSpecs().recommended
  return {
    workers,
    heavy: heavyJobsAtOnceOf(o?.heavyJobsAtOnce) ?? HEAVY_JOBS_DEFAULT,
    workersFloor: minWorkersFloor(workers, minWorkersUnderPressureOf(o?.minWorkersUnderPressure))
  }
}

export function createLoadMonitor(d: LoadMonitorDeps): LoadMonitor {
  const now = d.nowMs ?? Date.now
  const platform = d.platform ?? process.platform
  const settingsFile = path.join(d.profileDir, 'app-settings.json')
  const histogram = d.readings ? null : monitorEventLoopDelay({ resolution: 20 })
  let commit: CommitReader | null = null
  const readings =
    d.readings ??
    ((): Readings => {
      const r: Readings = {
        memAvailablePct: memAvailablePct(platform),
        commitHeadroomPct: commit?.latest() ?? null,
        load1: os.loadavg()[0],
        cpus: os.availableParallelism?.() ?? os.cpus().length,
        loopDelayP99Ns: histogram!.percentile(99)
      }
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
      let person: Required<PersonCaps> | null = null
      try {
        person = await personCaps(settingsFile)
      } catch {
        /* an unreadable settings file: the snapshot is still written, nothing is judged */
      }
      const effective = person && { workers: effectiveCap(person.workers, cur.workers), heavy: effectiveCap(person.heavy, cur.heavy) }
      const l = d.live()
      const live: LiveCounts = { workers: l.workers, heavyRunning: Math.min(l.heavyTickets, effective?.heavy ?? l.heavyTickets), checksRunning: l.checks }
      const snapshot: HealthSnapshot = {
        at: new Date(at).toISOString(),
        // Unknown memory is written as 100 (not strained) and flagged, never as 0% free.
        memAvailablePct: sample.memAvailablePct ?? 100,
        load1PerCpu: sample.load1PerCpu,
        loopDelayP99Ms: sample.loopDelayP99Ms,
        strained: isStrained(sample),
        liveWorkers: live.workers,
        liveSessions: l.sessions,
        heavyRunning: live.heavyRunning,
        checksRunning: live.checksRunning
      }
      if (sample.memAvailablePct === null) snapshot.memUnknown = true
      if (typeof sample.commitHeadroomPct === 'number') snapshot.commitHeadroomPct = sample.commitHeadroomPct
      writeHealthSnapshotSync(d.profileDir, snapshot)
      if (!person || !effective) return
      const update = judge(samples, cur, live, effective, person, at)
      if (!update) return
      const iso = new Date(at).toISOString()
      const after = await updateAutoLimits(d.profileDir, update)
      const lines = changeLines(
        after.history.filter((h) => h.at === iso && h.cause !== 'reset'),
        { stage: update.stage, floor: update.floor }
      )
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
      // The Windows commit reader starts with the monitor, so the first samples already have a reading.
      if (!d.readings) {
        commit = createCommitReader({ platform })
        commit.latest()
      }
      timer = setInterval(() => void tick(), SAMPLE_MS)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      histogram?.disable()
      commit?.stop()
      commit = null
    }
  }
}
