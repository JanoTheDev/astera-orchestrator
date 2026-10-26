// Which of the explorer's context-menu items a row gets beyond the generic ones, and the Local History filter for a file.
import type { GitState } from '../../../core/git/status'
import type { LocalHistoryEntry } from '../../../core/types'

export type ExplorerPathItem = 'open' | 'openDiff' | 'openTerminal'

/** Open for a file; Open Diff only for a file git reports modified; Open in Terminal for a folder. */
export function explorerPathItems(entry: { isDir: boolean }, gitState: GitState | undefined): ExplorerPathItem[] {
  if (entry.isDir) return ['openTerminal']
  return gitState === 'modified' ? ['open', 'openDiff'] : ['open']
}

/** Local History opened from a file lists that file's snapshots only; without a file it lists the whole project. */
export function historyForFile(list: LocalHistoryEntry[], file: string | undefined): LocalHistoryEntry[] {
  return file ? list.filter((e) => e.originalPath === file) : list
}
