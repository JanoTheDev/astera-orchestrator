// Moving a file or folder in `<profile>/plugins`. Windows refuses to rename one while a scanner or the indexer holds a
// file in it, and lets go within seconds; npm's graceful-fs waits up to a minute for the same reason.
import { promises as fs } from 'node:fs'

/** The waits between tries of a refused move, about 27 s in all. */
export const RENAME_WAITS_MS: readonly number[] = [50, 100, 200, 400, 800, 1600, ...Array<number>(12).fill(2000)]

/** A refusal that is worth waiting out. */
export const transient = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

export type Rename = (from: string, to: string) => Promise<void>

export const plainRename: Rename = (from, to) => fs.rename(from, to)

/** Renames, trying again after each wait while the system refuses for a moment. */
export async function moveRetrying(from: string, to: string, o: { rename?: Rename; waitsMs?: readonly number[] } = {}): Promise<void> {
  const rename = o.rename ?? plainRename
  const waits = o.waitsMs ?? RENAME_WAITS_MS
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to)
    } catch (e) {
      if (i >= waits.length || !transient(e)) throw e
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}
