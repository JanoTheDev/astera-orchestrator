// The Explorer's Changed pane (a flat list of the changed files, a status letter on each). A plan's worktree lists the files changed against its
// base branch as well as the uncommitted ones. A click shows the file's diff read by readFileDiff (git.fileDiff:
// against the working tree, so uncommitted edits and deleted files are in it); a file with no diff opens in the editor.
import { useEffect, useMemo, useState } from 'react'
import type { ChangedFile } from '../../../core/git/changedFile'
import { resolveFileIcon } from '../../../core/files/icons'
import type { GitState } from '../../../core/git/status'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useI18n } from '../i18n/I18nProvider'
import { isMac } from '../lib/platformKeys'
import { toast } from '../lib/toast'
import { changedFileLabels, changedFileMenu } from './changedFileMenu'
import { DiffView } from './DiffView'
import { GIT_LABEL } from './ExplorerRow'
import { FileIcon } from './FileIcon'
import { Button, EmptyState, ICONS, Icon, IconButton, Menu, menuPointOf, type MenuItem } from './ui'
import { changedRows, changeLetter, type ChangedRow, type ChangeKind } from './explorerChanged'

/** A row's status as the letter, colour and label show it: a renamed file reads R whatever its git state. */
const kind = (r: ChangedRow): ChangeKind => (r.renamed ? 'renamed' : r.state)
const label = (r: ChangedRow) => (r.renamed ? ('explorer.git.renamed' as const) : GIT_LABEL[r.state])

type Diff = { path: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean })

export function ChangedList({ root, gitStatus, onOpenFile }: { root: string; gitStatus: GitStatusMap; onOpenFile: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const [base, setBase] = useState<ChangedFile[] | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; file: ChangedRow } | null>(null)
  const { fileState } = gitStatus

  // Read again whenever the git status changed: the same refresh the badges use
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const w = (await window.api.worktrees.list()).find((x) => x.path === root && x.status === 'ok')
        const d = w ? await window.api.worktrees.detail(w.id) : null
        if (alive) setBase(d?.files ?? null)
      } catch {
        if (alive) setBase(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [root, fileState])
  useEffect(() => setDiff(null), [root])

  const rows = useMemo(() => changedRows(root, fileState, base), [root, fileState, base])

  // Toggles the file's diff. `noDiff` runs when there is none (an untracked file, or git could not answer)
  const toggleDiff = (path: string, noDiff: (() => void) | null): void => {
    if (diff?.path === path) return setDiff(null)
    setDiff({ path, state: 'loading' })
    const same = (cur: Diff | null): boolean => cur?.path === path
    const none = (): void => {
      setDiff((cur) => (!same(cur) ? cur : null))
      noDiff?.()
    }
    void window.api.git.fileDiff(root, path).then(
      (d) => (d ? setDiff((cur) => (!same(cur) ? cur : { path, state: 'shown', ...d })) : none()),
      none
    )
  }
  // A click on a file with no diff opens it in the editor, unless it was deleted
  const click = (path: string, state: GitState): void => toggleDiff(path, state !== 'deleted' ? () => onOpenFile(path) : null)

  const fileMenuItems = (r: ChangedRow): Array<MenuItem | 'separator'> =>
    changedFileMenu(
      { status: kind(r), path: r.path, relative: r.dir ? `${r.dir}/${r.name}` : r.name },
      changedFileLabels(t, isMac()),
      {
        open: onOpenFile,
        diff: () => toggleDiff(r.path, null),
        copy: (text) => window.api.clipboard.writeText(text),
        reveal: (path) =>
          void window.api.files.reveal(path).catch((err: unknown) => toast.error(t('explorer.reveal.failed', { detail: err instanceof Error ? err.message : String(err) })))
      }
    )

  if (rows.length === 0) return <EmptyState icon={ICONS.check} title={t('explorer.changed.empty')}>{t('explorer.changed.emptyHint')}</EmptyState>
  // Arrows move between the rows (the list is one Tab stop's worth of rows, as the tree is); Enter/Space open a row's diff
  const moveFocus = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0
    const home = ev.key === 'Home' ? 0 : ev.key === 'End' ? -1 : null
    if (!step && home === null) return
    const btns = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>('.fx-changed-row'))
    const at = btns.indexOf(document.activeElement as HTMLButtonElement)
    const next = home !== null ? (home === 0 ? 0 : btns.length - 1) : Math.min(btns.length - 1, Math.max(0, at + step))
    if (btns.length === 0) return
    ev.preventDefault()
    btns[next].focus()
  }
  return (
    <div className={`fx-tree ui-tree${gitStatus.stale ? ' git-stale' : ''}`} onKeyDown={moveFocus}>
      {rows.map((r) => (
        <div key={r.path}>
          <div className="fx-changed-item">
          <Button
            variant="ghost"
            className="fx-changed-row"
            title={r.path}
            aria-expanded={diff?.path === r.path && diff.state === 'shown'}
            onClick={() => click(r.path, r.state)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ at: menuPointOf(e), file: r })
            }}
          >
            <FileIcon {...resolveFileIcon(r.name)} />
            <span className={`fx-name git-${kind(r)}`}>{r.name}</span>
            {r.dir && <span className="fx-note">{r.dir}</span>}
            <span className={`fx-git-mark git-${kind(r)}`} title={t(label(r))} aria-label={t(label(r))}>
              {changeLetter(kind(r))}
            </span>
          </Button>
          {r.state !== 'deleted' && (
            <IconButton size="sm" className="fx-changed-open" icon={<Icon name="open" size={14} />} label={t('changedFile.menu.open')} onClick={() => onOpenFile(r.path)} />
          )}
          </div>
          {diff?.path === r.path && diff.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={r.binary === true} />}
        </div>
      ))}
      {menu && <Menu at={menu.at} items={fileMenuItems(menu.file)} onClose={() => setMenu(null)} />}
    </div>
  )
}
