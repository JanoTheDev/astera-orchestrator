// The right-click menu of a changed-file row (Explorer Changed, Source Control's Changes tree, the worktree tab). Pure: which
// items show, which are off and what each one does are decided here, so the three lists only wire their own handlers.
import type { MessageKey } from '../../../core/i18n'
import type { ChangeKind } from './explorerChanged'
import type { MenuItem } from './ui/Menu'

export type ChangedFileAction = 'open' | 'diff' | 'copyPath' | 'copyRelative' | 'reveal'

export interface ChangedFileTarget {
  status: ChangeKind
  /** Absolute: what open and reveal take. */
  path: string
  /** As the list shows it: relative to the project or worktree root. */
  relative: string
}

export interface ChangedFileHandlers {
  open: (path: string) => void
  diff: () => void
  copy: (text: string) => void
  reveal: (path: string) => void
}

/** The absolute path of a file that git lists relative to `root` (forward slashes, as git prints it). */
export const absoluteOf = (root: string, rel: string): string => `${root.replace(/[\\/]+$/, '')}/${rel}`

export function changedFileLabels(t: (key: MessageKey) => string, mac: boolean): Record<ChangedFileAction, string> {
  return {
    open: t('changedFile.menu.open'),
    diff: t('changedFile.menu.diff'),
    copyPath: t('explorer.menu.copyPath'),
    copyRelative: t('explorer.menu.copyRelativePath'),
    reveal: t(mac ? 'explorer.menu.revealMac' : 'explorer.menu.reveal')
  }
}

/** A deleted file is gone from disk, so it cannot be opened or revealed: both items are off. Diff and copy stay on. */
export function changedFileMenu(f: ChangedFileTarget, label: Record<ChangedFileAction, string>, h: ChangedFileHandlers): Array<MenuItem | 'separator'> {
  const gone = f.status === 'deleted'
  return [
    { id: 'open', label: label.open, disabled: gone, onSelect: () => h.open(f.path) },
    { id: 'diff', label: label.diff, onSelect: () => h.diff() },
    'separator',
    { id: 'copyPath', label: label.copyPath, onSelect: () => h.copy(f.path) },
    { id: 'copyRelative', label: label.copyRelative, onSelect: () => h.copy(f.relative) },
    'separator',
    { id: 'reveal', label: label.reveal, disabled: gone, onSelect: () => h.reveal(f.path) }
  ]
}
