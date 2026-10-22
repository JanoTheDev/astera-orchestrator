// T27: crash reports on disk, <profile>/crash-reports/<id>.json. The directory is 700 and each file 600 (Ubuntu's
// umask is 002, so both are set explicitly). Writes are synchronous: the main process and the Host write from their
// last handler, right before the process may end.
import { closeSync, chmodSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeFileSync, fstatSync, promises as fsp } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { toPrune, type CrashEnv, type CrashReport } from './report'

export const CRASH_DIR = 'crash-reports'
const ID_RE = /^[\w-]+\.json$/

export function nodeCrashEnv(version: string, build: string): CrashEnv {
  return { version, build, os: `${os.platform()} ${os.release()}`, arch: os.arch(), home: os.homedir() }
}

/** Writes the report and prunes the old ones; returns its id (the file name). Throws when the disk does. */
export function writeReportSync(dir: string, report: CrashReport): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
  const id = `${report.at.replace(/[:.]/g, '-')}-${report.process}-${randomBytes(3).toString('hex')}.json`
  writeFileSync(path.join(dir, id), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' })
  pruneSync(dir)
  return id
}

function pruneSync(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((n) => ID_RE.test(n))
      .map((name) => ({ name, mtimeMs: statSync(path.join(dir, name)).mtimeMs }))
    for (const n of toPrune(files, Date.now())) unlinkSync(path.join(dir, n))
  } catch {
    /* pruning is housekeeping: a failure leaves a file one more day */
  }
}

const isReport = (v: unknown): v is CrashReport =>
  typeof v === 'object' && v !== null && typeof (v as CrashReport).errorName === 'string' && Array.isArray((v as CrashReport).stack)

/** One report by id, or null. The id arrives from the renderer: only a plain file name in the directory is read. */
export async function readReport(dir: string, id: string): Promise<CrashReport | null> {
  if (!ID_RE.test(id)) return null
  try {
    const v: unknown = JSON.parse(await fsp.readFile(path.join(dir, id), 'utf8'))
    return isReport(v) ? v : null
  } catch {
    return null
  }
}

/** Reports the prompt has not offered yet, oldest first. */
export async function pendingReports(dir: string): Promise<Array<{ id: string; report: CrashReport }>> {
  const names = await fsp.readdir(dir).catch(() => [] as string[])
  const out: Array<{ id: string; report: CrashReport }> = []
  for (const id of names.filter((n) => ID_RE.test(n)).sort()) {
    const report = await readReport(dir, id)
    if (report && !report.offered) out.push({ id, report })
  }
  return out
}

/** Marks a report offered, so the next start does not ask about it again. Keeps the file's 600. */
export async function markOffered(dir: string, id: string): Promise<void> {
  const report = await readReport(dir, id)
  if (!report || report.offered) return
  await fsp.writeFile(path.join(dir, id), JSON.stringify({ ...report, offered: true }, null, 2), { mode: 0o600 })
}

/** The last `bytes` of a file, or undefined when it cannot be read. */
export function tailSync(p: string, bytes = 16_384): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(p, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
