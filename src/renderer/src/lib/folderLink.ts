// What a folder link in a terminal opens (D2, 2026-10-14): a folder of the project the explorer shows is revealed in the
// app's explorer; any other folder opens in the system file manager (files.openFolder). Pure, so App only wires it.

export type FolderLinkAction = { kind: 'explorer'; segments: string[] } | { kind: 'system' }

/** A Windows path: a drive letter, or a backslash anywhere. Its comparisons ignore case, as the file system does. */
export const isWindowsPath = (p: string): boolean => /^[A-Za-z]:/.test(p) || p.includes('\\')
/** One spelling for comparing: forward slashes, no repeated or trailing separator. */
const slashed = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1')

/** `folder` against the root the explorer shows: the names from the root down to the folder, or the system file
 *  manager when the folder is not under that root (or there is none). */
export function folderLinkAction(folder: string, root: string | null): FolderLinkAction {
  if (root === null || root === '') return { kind: 'system' }
  const win = isWindowsPath(folder) || isWindowsPath(root)
  const f = slashed(folder)
  const r = slashed(root)
  const same = (a: string, b: string): boolean => (win ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (same(f, r)) return { kind: 'explorer', segments: [] }
  const prefix = r.endsWith('/') ? r : r + '/'
  if (f.length <= prefix.length || !same(f.slice(0, prefix.length), prefix)) return { kind: 'system' }
  return { kind: 'explorer', segments: f.slice(prefix.length).split('/') }
}

/** The explorer's keys for each folder from the root's child down to the last of `segments`, found by listing each
 *  level as the explorer does (main's files.list: path.join of the parent's key and the name), the name matched
 *  without regard to case on Windows. null when a name is no folder there, or a listing fails. */
export async function treeKeysTo(
  root: string,
  segments: readonly string[],
  list: (dir: string) => Promise<ReadonlyArray<{ name: string; path: string; isDir: boolean }>>,
  win: boolean
): Promise<string[] | null> {
  const keys: string[] = []
  let at = root
  for (const name of segments) {
    let entries: ReadonlyArray<{ name: string; path: string; isDir: boolean }>
    try {
      entries = await list(at)
    } catch {
      return null
    }
    const next = entries.find((e) => e.isDir && (win ? e.name.toLowerCase() === name.toLowerCase() : e.name === name))
    if (!next) return null
    keys.push(next.path)
    at = next.path
  }
  return keys
}
