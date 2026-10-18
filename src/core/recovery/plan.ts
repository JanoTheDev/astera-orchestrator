// T23: plan state on disk survives a crash. orchestration.json is written whole on every commit, so a laptop that
// dies mid-write must find either the old file or the new one, never half of one, and a file that still comes back
// unreadable (a disk that lied about the flush) is answered from the last copy that was good.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameRetrying } from '../renameRetry'

/** Beside the file: the version before the newest write. */
export const LAST_GOOD_SUFFIX = '.last-good'

/**
 * Writes `text` to `file` so a crash at any point leaves a whole file: a temp file in the same folder, flushed to the
 * disk (fsync), then renamed over the target, then the folder flushed so the rename itself is on disk. Before the
 * rename the current file is kept as `<file>.last-good` — a hard link, so keeping it costs no copy; a copy where the
 * file system has no links.
 */
export async function writeDurably(file: string, text: string): Promise<void> {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    const fh = await fs.open(tmp, 'w')
    try {
      await fh.writeFile(text, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await keepLastGood(file)
    // Retried: on Windows a rename over a file another process holds open for a moment is refused.
    await renameRetrying(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  await syncDir(dir)
}

/** The current file as `<file>.last-good`, before it is replaced. Nothing when there is no file yet; a failure here
 *  costs only the extra copy, never the write. */
async function keepLastGood(file: string): Promise<void> {
  const keep = file + LAST_GOOD_SUFFIX
  try {
    await fs.rm(keep, { force: true })
    await fs.link(file, keep)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    await fs.copyFile(file, keep).catch(() => {})
  }
}

/** Flushes a folder's entries (POSIX). Windows cannot open a folder for this and needs nothing: its rename is
 *  journaled by NTFS. */
async function syncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const fh = await fs.open(dir, 'r')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
  } catch {
    /* best effort: the file itself is already flushed */
  }
}

/** The last good copy, parsed, or null when there is none or it does not parse either. */
export async function readLastGood(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file + LAST_GOOD_SUFFIX, 'utf8'))
  } catch {
    return null
  }
}
