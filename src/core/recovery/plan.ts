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
      // One write request, not `writeFile`'s 512 KiB chunks: each chunk waits its own turn in libuv's pool, so a 16 MB
      // state behind a busy pool cost 33 waits (2026-11-15: state-put past 15 s while a small read waited 10 s).
      const buf = Buffer.from(text, 'utf8')
      for (let at = 0; at < buf.length; ) at += (await fh.write(buf, at, buf.length - at, at)).bytesWritten
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

/** `file` as text, read in one request rather than `readFile`'s 512 KiB chunks (the reason is in writeDurably). */
export async function readWhole(file: string): Promise<string> {
  const fh = await fs.open(file, 'r')
  try {
    const { size } = await fh.stat()
    const buf = Buffer.allocUnsafe(size)
    let at = 0
    while (at < size) {
      const { bytesRead } = await fh.read(buf, at, size - at, at)
      if (bytesRead === 0) break
      at += bytesRead
    }
    return buf.toString('utf8', 0, at)
  } finally {
    await fh.close()
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
