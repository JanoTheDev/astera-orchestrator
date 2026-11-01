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
import { AutoLimitsReadOnlyError, effectiveCap, readAutoLimits, updateAutoLimits, writeHealthSnapshotSync, type AutoLimits, type HealthSnapshot } from '../core/settings/autoLimits'
import { lowerPolicyOf, type AutoLowerMode } from '../core/settings/autoLowerLimits'
import { personHeavyJobsOf, type HeavyJobsDeps } from '../core/settings/heavyJobs'
import { machineSpecs } from '../core/settings/machineSpecs'
import { maxConcurrentWorkersOf } from '../core/settings/maxConcurrentWorkers'
import { minWorkersFloor } from '../core/settings/minWorkersUnderPressure'
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
/** Windows commit headroom thresholds, against the commit limit the machine can still reach (RAM + the pagefiles at the
 *  most they can grow to). Allocations fail when the commit charge reaches the commit limit, which can happen while
 *  physical memory still looks free. Against the current limit they are not used: a system-managed pagefile grows on
 *  demand, so headroom against it sits at 2-4% on a healthy machine (knowledge/history/2026-10-31-memory-at-25-agents.md). */
export const COMMIT_STRAINED_PCT = 10
export const COMMIT_CRITICAL_PCT = 5
/** Windows: low commit headroom counts as strain only while physical memory is also under this. Commit headroom of 9%
 *  with a fifth of the RAM free is a machine with room to spare, not one about to fail allocations. */
export const COMMIT_NEEDS_MEM_BELOW_PCT = 15
/** A pause on writing auto-limits.json (read-only) is looked at again this often; a repeated error is logged this often. */
export const READ_ONLY_RECHECK_MS = 10 * 60_000
export const ERROR_LOG_EVERY_MS = 10 * 60_000
/** Free space a growing pagefile leaves on its volume, in GB. */
export const PAGEFILE_DISK_MARGIN_GB = 4
/** How often the Windows commit reader asks, and how old its last answer may be before it reads as unknown. */
export const COMMIT_READ_MS = 30_000
export const COMMIT_STALE_MS = 3 * COMMIT_READ_MS

export interface Sample {
  /** ms since the epoch */
  at: number
  /** Available memory, % of total; null when the OS gave no usable reading (unknown is not strain) */
  memAvailablePct: number | null
  /** Windows: 100 * (commit limit - committed) / commit limit, against the current limit; for diagnosis, and for the
   *  fallback rule when `commitReachablePct` is unknown. Null or absent when unknown or not Windows. */
  commitHeadroomPct?: number | null
  /** Windows: the same headroom against the commit limit the machine can still reach (reachableCommitLimitKb). Strain
   *  and critical from commit are judged by this one. Null or absent when unknown or not Windows. */
  commitReachablePct?: number | null
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
  /** The auto-lower setting; not given: floor. Under 'off' a strain lowers nothing (raising own lowerings still runs). */
  autoLower?: AutoLowerMode
}

const below = (x: number | null | undefined, pct: number): x is number => typeof x === 'number' && x < pct
const memLow = (s: Sample, pct: number): boolean => below(s.memAvailablePct, pct)
/** Physical memory is not known to be ample: under COMMIT_NEEDS_MEM_BELOW_PCT, or not read (unknown must not hide a
 *  commit shortage, though it is no strain by itself). */
const memNotAmple = (s: Sample): boolean => s.memAvailablePct === null || memLow(s, COMMIT_NEEDS_MEM_BELOW_PCT)
/** Commit is strained by the reachable headroom, and only while physical memory is under COMMIT_NEEDS_MEM_BELOW_PCT
 *  (or unknown) too. Without the reachable reading, low headroom against the current limit counts only when physical memory is low
 *  too: the pagefile may still grow, so it alone says nothing. */
const commitStrained = (s: Sample): boolean =>
  typeof s.commitReachablePct === 'number'
    ? s.commitReachablePct < COMMIT_STRAINED_PCT && memNotAmple(s)
    : below(s.commitHeadroomPct, COMMIT_STRAINED_PCT) && memLow(s, MEM_STRAINED_PCT)
/** Commit is critical only by the reachable headroom, never from the current limit alone, and with physical memory low. */
const commitCritical = (s: Sample): boolean => below(s.commitReachablePct, COMMIT_CRITICAL_PCT) && memNotAmple(s)

export const isStrained = (s: Sample): boolean =>
  memLow(s, MEM_STRAINED_PCT) || commitStrained(s) || s.loopDelayP99Ms > 1000 || s.load1PerCpu > 3
export const isCritical = (s: Sample): boolean => memLow(s, MEM_CRITICAL_PCT) || commitCritical(s)

// ── Readings ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the OS said at one moment. The sampler reads it; `sampleOf` turns it into a Sample. */
export interface Readings {
  /** NaN when the OS gave nothing usable */
  memAvailablePct: number
  /** Windows commit headroom % against the current limit; null or absent when unknown or not Windows */
  commitHeadroomPct?: number | null
  /** Windows commit headroom % against the reachable limit; null or absent when unknown or not Windows */
  commitReachablePct?: number | null
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
    commitReachablePct: pctOrNull(r.commitReachablePct),
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

/** One pagefile as the commit reader prints it. */
export interface PagefileReading {
  /** The drive it is on, "C:" */
  volume: string
  /** MB: 0 is system-managed (Windows sizes it), above 0 the fixed maximum, -1 unknown (it is not grown) */
  maxMb: number
  /** MB allocated now */
  allocatedMb: number
  /** Bytes free on its volume, -1 unknown (it is not grown) */
  volumeFreeBytes: number
  /** Bytes of its volume, -1 unknown */
  volumeSizeBytes: number
}

const GB_KB = 1024 * 1024

/**
 * The commit limit the machine can still reach, in KB: the current limit (RAM + the pagefiles as allocated now) plus what
 * each pagefile can still grow by. Windows' rule for a system-managed pagefile: at most 3 x RAM (4 GB at the least), and
 * no more than an eighth of its volume. A fixed one grows to its maximum. Either is capped by the free space on its
 * volume less PAGEFILE_DISK_MARGIN_GB, shared between the pagefiles on one volume. An unknown maximum or free space
 * grows nothing. Pure.
 */
export function reachableCommitLimitKb(a: { limitKb: number; ramKb: number; pagefiles: readonly PagefileReading[] }): number {
  const room = new Map<string, number>()
  let growth = 0
  for (const p of a.pagefiles) {
    const vol = p.volume.toUpperCase()
    if (!room.has(vol)) room.set(vol, p.volumeFreeBytes >= 0 ? Math.max(0, p.volumeFreeBytes / 1024 - PAGEFILE_DISK_MARGIN_GB * GB_KB) : 0)
    const allocKb = Math.max(0, p.allocatedMb) * 1024
    let maxKb = allocKb
    if (p.maxMb === 0) {
      maxKb = Math.max(3 * a.ramKb, 4 * GB_KB)
      if (p.volumeSizeBytes > 0) maxKb = Math.min(maxKb, p.volumeSizeBytes / 1024 / 8)
    } else if (p.maxMb > 0) maxKb = p.maxMb * 1024
    const left = room.get(vol) ?? 0
    const g = Math.max(0, Math.min(maxKb - allocKb, left))
    room.set(vol, left - g)
    growth += g
  }
  return a.limitKb + growth
}

/** One reading of the commit reader: headroom % against the current commit limit, and against the reachable one (null
 *  when the pagefile part of the reading failed). */
export interface CommitReading {
  headroomPct: number
  reachablePct: number | null
}

/**
 * One line of the commit reader:
 *   "<FreeVirtualMemory KB> <TotalVirtualMemorySize KB>[ | <TotalVisibleMemorySize KB> <pagefile>...]"
 * from Win32_OperatingSystem (the commit limit minus the commit charge, the commit limit, RAM), each pagefile as
 * "<volume>,<max MB>,<allocated MB>,<volume free bytes>,<volume size bytes>" (PagefileReading). Null for a line without
 * the first two numbers; a missing or malformed part after "|" leaves only the reachable headroom unknown.
 */
export function commitReadingOf(line: string): CommitReading | null {
  const bar = line.indexOf('|')
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(bar >= 0 ? line.slice(0, bar) : line)
  if (!m) return null
  const free = Number(m[1])
  const limit = Number(m[2])
  if (!(limit > 0) || !Number.isFinite(free)) return null
  const committed = limit - Math.min(free, limit)
  const headroomPct = (100 * (limit - committed)) / limit
  return { headroomPct, reachablePct: bar >= 0 ? reachablePctOf(line.slice(bar + 1), limit, committed) : null }
}

function reachablePctOf(tail: string, limitKb: number, committedKb: number): number | null {
  const [ram, ...rest] = tail.trim().split(/\s+/)
  if (!/^\d+$/.test(ram ?? '') || !(Number(ram) > 0)) return null
  const pagefiles: PagefileReading[] = []
  for (const t of rest) {
    const p = /^([A-Za-z]:),(-?\d+),(\d+),(-?\d+),(-?\d+)$/.exec(t)
    if (!p) return null
    pagefiles.push({ volume: p[1], maxMb: Number(p[2]), allocatedMb: Number(p[3]), volumeFreeBytes: Number(p[4]), volumeSizeBytes: Number(p[5]) })
  }
  const reach = reachableCommitLimitKb({ limitKb, ramKb: Number(ram), pagefiles })
  return (100 * Math.max(0, reach - committedKb)) / reach
}

/** The PowerShell loop the commit reader runs: one set of CIM queries every 30 s, so a sample costs no process start. It
 *  leaves when the Host that started it is gone or its stdout closes. CIM class and property names are not localised,
 *  unlike the performance counter names typeperf takes. The pagefile part (Win32_ComputerSystem.AutomaticManagedPagefile,
 *  Win32_PageFileSetting.MaximumSize, Win32_PageFileUsage.AllocatedBaseSize, Win32_LogicalDisk) is left off the line
 *  when any of it fails, which leaves the reachable headroom unknown. */
export function commitReaderScript(parentPid: number, everyMs: number = COMMIT_READ_MS): string {
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `while ($true) {`,
    `if (-not (Get-Process -Id ${Math.floor(parentPid)})) { exit }`,
    `$o = Get-CimInstance -ClassName Win32_OperatingSystem -Property FreeVirtualMemory,TotalVirtualMemorySize,TotalVisibleMemorySize`,
    `$x = ''`,
    `try {`,
    `$auto = (Get-CimInstance -ClassName Win32_ComputerSystem -Property AutomaticManagedPagefile -ErrorAction Stop).AutomaticManagedPagefile`,
    `$set = @(Get-CimInstance -ClassName Win32_PageFileSetting -Property Name,MaximumSize -ErrorAction Stop)`,
    `$pf = @(foreach ($u in @(Get-CimInstance -ClassName Win32_PageFileUsage -Property Name,AllocatedBaseSize -ErrorAction Stop)) {`,
    `$s = @($set | Where-Object { $_.Name -eq $u.Name })[0]`,
    `$max = if ($auto) { 0 } elseif ($s) { [int64]$s.MaximumSize } else { -1 }`,
    `$dev = $u.Name.Substring(0, 2)`,
    `$d = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$dev'" -Property DeviceID,FreeSpace,Size -ErrorAction Stop`,
    `$free = if ($d -and $null -ne $d.FreeSpace) { [int64]$d.FreeSpace } else { -1 }`,
    `$size = if ($d -and $null -ne $d.Size) { [int64]$d.Size } else { -1 }`,
    `"$dev,$max,$([int64]$u.AllocatedBaseSize),$free,$size"`,
    `})`,
    `if ($o.TotalVisibleMemorySize) { $x = (@(" | $($o.TotalVisibleMemorySize)") + $pf) -join ' ' }`,
    `} catch { $x = '' }`,
    `try { [Console]::Out.WriteLine("$($o.FreeVirtualMemory) $($o.TotalVirtualMemorySize)$x"); [Console]::Out.Flush() } catch { exit }`,
    `Start-Sleep -Milliseconds ${Math.max(1000, Math.round(everyMs))}`,
    `}`
  ].join('\n')
}

/** powershell -EncodedCommand takes the script as base64 UTF-16LE: no quoting of a multi-line script on a command line. */
export const encodedCommand = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

export interface CommitReader {
  /** The last reading, or null when unknown (not Windows, not read yet, unreadable, or older than COMMIT_STALE_MS). */
  latest(): CommitReading | null
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
  let value: { reading: CommitReading; at: number } | null = null

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
        const reading = commitReadingOf(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (reading !== null) value = { reading, at: now() }
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
      return value && now() - value.at <= COMMIT_STALE_MS ? value.reading : null
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
  if (commitStrained(s)) {
    const cur = typeof s.commitHeadroomPct === 'number' ? Math.round(s.commitHeadroomPct) : null
    if (typeof s.commitReachablePct === 'number') {
      parts.push(`commit headroom ${Math.round(s.commitReachablePct)}% of the reachable limit${cur === null ? '' : ` (${cur}% of the current one)`}`)
    } else parts.push(`commit headroom ${cur}% of the current limit`)
  }
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
  const { strain, critical } = strainOf(samples)
  if (strain) return person.autoLower === 'off' ? null : lowering(latest, cur, live, effective, person.workersFloor ?? minWorkersFloor(person.workers, null), critical, now)
  return raising(samples, cur, person, now)
}

/** Strain is the last 3 samples strained, or the last 2 critical. */
export function strainOf(samples: readonly Sample[]): { strain: boolean; critical: boolean } {
  const last3 = samples.slice(-3)
  const last2 = samples.slice(-2)
  const critical = last2.length === 2 && last2.every(isCritical)
  return { strain: (last3.length === 3 && last3.every(isStrained)) || critical, critical }
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
  // The pause holds the agents that run, but never below the floor (minWorkersUnderPressure) either
  const pauseTo = Math.max(floor, live.workers)
  const pause: Plan = { stage: 'pause', workers: live.workers >= 1 && pauseTo < effective.workers ? pauseTo : null, heavy, checks }
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
  /** What the auto heavy-slot answer reads (memory, held slots) when heavyJobsAtOnce is unset or "auto". */
  heavyJobs?: HeavyJobsDeps
  platform?: NodeJS.Platform
  nowMs?: () => number
}

export interface LoadMonitor {
  start(): void
  stop(): void
  /** One sample, judged. Never rejects. */
  tick(): Promise<void>
}

/** The person's own caps, without any auto-limit, and the floor under strain. Heavy slots unset or "auto" are the auto
 *  answer the heavy slots themselves use, so the first strain stage tightens them and a raise stops there. */
async function personCaps(settingsFile: string, heavyJobs?: HeavyJobsDeps): Promise<Required<PersonCaps>> {
  const o = await readAppSettingsObject(settingsFile)
  const workers = maxConcurrentWorkersOf(o?.maxConcurrentWorkers) ?? machineSpecs().recommended
  const policy = lowerPolicyOf(o, workers)
  return { workers, heavy: personHeavyJobsOf(o?.heavyJobsAtOnce, heavyJobs), workersFloor: policy.floor, autoLower: policy.mode }
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
      const c = commit?.latest() ?? null
      const r: Readings = {
        memAvailablePct: memAvailablePct(platform),
        commitHeadroomPct: c?.headroomPct ?? null,
        commitReachablePct: c?.reachablePct ?? null,
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
  // A read-only auto-limits.json: one log line, then no writes until this time, then a quiet look again.
  let writePausedUntil = 0
  let readOnlyLogged = false
  // Under 'off' a strain is logged once, not every 10 s.
  let offStrainLogged = false
  // A repeated tick error is logged at most once per ERROR_LOG_EVERY_MS, with how many were left out.
  const errors = new Map<string, { loggedAt: number; skipped: number }>()
  const logError = (err: unknown, at: number): void => {
    const text = String(err)
    const seen = errors.get(text)
    if (seen && at - seen.loggedAt < ERROR_LOG_EVERY_MS) {
      seen.skipped++
      return
    }
    d.log(`load monitor: ${text}${seen && seen.skipped > 0 ? ` (${seen.skipped} more since the last line)` : ''}`)
    errors.set(text, { loggedAt: at, skipped: 0 })
  }

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
        person = await personCaps(settingsFile, d.heavyJobs)
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
      if (typeof sample.commitReachablePct === 'number') snapshot.commitReachablePct = sample.commitReachablePct
      writeHealthSnapshotSync(d.profileDir, snapshot)
      if (!person || !effective) return
      if (person.autoLower === 'off') {
        if (!isStrained(sample)) offStrainLogged = false
        else if (!offStrainLogged && strainOf(samples).strain) {
          offStrainLogged = true
          d.log(`load monitor: strained (${seenLine(sample, live.workers)}); limits stay, Auto-lower agent limits is off`)
        }
      }
      const update = judge(samples, cur, live, effective, person, at)
      if (!update || at < writePausedUntil) return
      const iso = new Date(at).toISOString()
      let after: AutoLimits
      try {
        after = await updateAutoLimits(d.profileDir, update)
      } catch (err) {
        if (!(err instanceof AutoLimitsReadOnlyError)) throw err
        writePausedUntil = at + READ_ONLY_RECHECK_MS
        if (!readOnlyLogged) d.log('auto-limits.json is read-only; automatic limit changes are paused until it is writable')
        readOnlyLogged = true
        return
      }
      readOnlyLogged = false
      const lines = changeLines(
        after.history.filter((h) => h.at === iso && h.cause !== 'reset'),
        { stage: update.stage, floor: update.floor }
      )
      if (!lines) return
      d.log(lines.log)
      d.activity({ type: 'host.recovered', payload: { title: 'Astera', reason: lines.feed } })
    } catch (err) {
      logError(err, now())
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
