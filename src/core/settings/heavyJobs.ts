// Heavy-job slots: how many heavy jobs (full suite, Electron, dist build, a Task's heavy check) the machine runs at
// once (core/orchestration/heavyLock.ts). Not set (or "auto") sizes it from the memory available at each read; a
// number the owner set is used as is. An auto-limit (autoLimits.ts) lowers either.
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readAppSettingsObject } from './settingsObject'
import { effectiveCap, readAutoLimits } from './autoLimits'
import { MEMORY_PER_HEAVY_JOB_GB, RESERVED_MEMORY_GB } from './machineCap'
import { HEAVY_LOCK, HEAVY_QUEUE_DIR, heavyQueue, heavySlotLock } from '../orchestration/heavyLock'

/** The answer when the setting is invalid or unreadable: one slot, the safe one for a heavy job. */
export const HEAVY_JOBS_DEFAULT = 1
export const HEAVY_JOBS_MAX = 8
/** The stored value for auto sizing; leaving the key out means the same. */
export const HEAVY_JOBS_AUTO = 'auto'

const GB = 1024 ** 3

/** A whole number >= 1 (a larger one than HEAVY_JOBS_MAX reads as that cap), or null when not set or invalid. */
export function heavyJobsAtOnceOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, HEAVY_JOBS_MAX) : null
}

/** Heavy slots the available memory fits: what is free plus what the running heavy jobs already hold, less the
 *  reserve, in heavy jobs, clamped 1..HEAVY_JOBS_MAX. Adding the held jobs back keeps the answer from shrinking just
 *  because heavy jobs are running. Pure. */
export function autoHeavySlots(a: { availableBytes: number; heldSlots: number; perJobGb?: number; reservedGb?: number }): number {
  const perJob = a.perJobGb ?? MEMORY_PER_HEAVY_JOB_GB
  const reserved = a.reservedGb ?? RESERVED_MEMORY_GB
  const held = Number.isFinite(a.heldSlots) ? Math.max(0, a.heldSlots) : 0
  const n = Math.floor((a.availableBytes / GB + held * perJob - reserved) / perJob)
  return Number.isFinite(n) ? Math.max(1, Math.min(HEAVY_JOBS_MAX, n)) : 1
}

/** MemAvailable in bytes from /proc/meminfo text; null when the line is missing. os.freemem() is MemFree on older
 *  Node, which counts the page cache as used. (host/loadMonitor.ts has the percentage form of the same parse.) */
export function memAvailableBytesOfMeminfo(text: string): number | null {
  const m = /^MemAvailable:\s+(\d+)/m.exec(text)
  return m ? Number(m[1]) * 1024 : null
}

export interface MemoryReading {
  platform?: NodeJS.Platform
  /** os.freemem(); on Windows that is ullAvailPhys, which counts standby pages as available. */
  freemem?: () => number
  /** The text of /proc/meminfo; throws when unreadable. */
  readMeminfo?: () => string
}

/** Memory available now, in bytes. Linux: MemAvailable; elsewhere (and when /proc/meminfo is unreadable) os.freemem(). */
export function availableMemoryBytes(r: MemoryReading = {}): number {
  if ((r.platform ?? process.platform) === 'linux') {
    try {
      const b = memAvailableBytesOfMeminfo((r.readMeminfo ?? (() => readFileSync('/proc/meminfo', 'utf8')))())
      if (b !== null) return b
    } catch {
      /* falls back to os below */
    }
  }
  return (r.freemem ?? os.freemem)()
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Heavy slots held now. Windows keeps one owner file per held slot (heavyLock.ts takeHeavySlotByFile), so those with a
 *  live pid are counted. Elsewhere the kernel's flock holds them and leaves no file to read, so the live tickets in the
 *  queue stand in, at most `limit` (a ticket may be waiting, not running). */
export function heldHeavySlots(
  a: { platform?: NodeJS.Platform; lock?: string; queueDir?: string; alive?: (pid: number) => boolean; limit?: number } = {}
): number {
  const alive = a.alive ?? pidAlive
  if ((a.platform ?? process.platform) === 'win32') {
    const lock = a.lock ?? HEAVY_LOCK
    let n = 0
    for (let k = 0; k < HEAVY_JOBS_MAX; k++) {
      const owner = `${heavySlotLock(lock, k)}.owner`
      if (!existsSync(owner)) continue
      try {
        const pid = Number(readFileSync(owner, 'utf8').trim())
        if (Number.isInteger(pid) && pid > 0 && alive(pid)) n++
      } catch {
        /* removed meanwhile */
      }
    }
    return n
  }
  return Math.min(heavyQueue(a.queueDir ?? HEAVY_QUEUE_DIR, alive).length, a.limit ?? HEAVY_JOBS_MAX)
}

export interface HeavyJobsDeps extends MemoryReading {
  /** Heavy slots held now; read from the lock files when left out. */
  held?: () => number
}

/** The auto answer now: sized from available memory and the slots held. */
export function currentAutoHeavySlots(d: HeavyJobsDeps = {}): number {
  const availableBytes = availableMemoryBytes(d)
  const held = d.held ?? (() => heldHeavySlots({ platform: d.platform, limit: autoHeavySlots({ availableBytes, heldSlots: 0 }) }))
  return autoHeavySlots({ availableBytes, heldSlots: held() })
}

/** A non-app process's read (CLI, Host, source updater), per call. Not set or "auto" is sized from available memory;
 *  a number is used as is; an auto-limit only lowers the answer. Never throws: an unreadable or invalid file is
 *  HEAVY_JOBS_DEFAULT, the safe answer for a heavy job. */
export async function readHeavyJobsAtOnce(filePath: string, deps: HeavyJobsDeps = {}): Promise<number> {
  try {
    const raw = (await readAppSettingsObject(filePath))?.heavyJobsAtOnce
    const person = raw === undefined || raw === HEAVY_JOBS_AUTO ? currentAutoHeavySlots(deps) : (heavyJobsAtOnceOf(raw) ?? HEAVY_JOBS_DEFAULT)
    return effectiveCap(person, (await readAutoLimits(path.dirname(filePath))).heavy) // T1: auto-limits only lower
  } catch {
    return HEAVY_JOBS_DEFAULT
  }
}
