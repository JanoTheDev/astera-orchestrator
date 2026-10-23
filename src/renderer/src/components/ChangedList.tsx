// The Explorer's Changed pane (a flat list of the changed files, a status letter on each). A plan's worktree lists the files changed against its
// base branch as well as the uncommitted ones. A click shows the file's diff read by readFileDiff (git.fileDiff:
// against the working tree, so uncommitted edits and deleted files are in it); a file with no diff opens in the editor.
import { useEffect, useMemo, useState } from 'react'
import type { ChangedFile } from '../../../core/git/changedFile'
import { resolveFileIcon } from '../../../core/files/icons'
import type { GitState } from '../../../core/git/status'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useI18n } from '../i18n/I18nProvider'
import { DiffView } from './DiffView'
import { GIT_LABEL } from './ExplorerRow'
import { FileIcon } from './FileIcon'
import { Button, EmptyState, ICONS } from './ui'
import { changedRows, changeLetter } from './explorerChanged'

type Diff = { path: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean })

export function ChangedList({ root, gitStatus, onOpenFile }: { root: string; gitStatus: GitStatusMap; onOpenFile: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const [base, setBase] = useState<ChangedFile[] | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
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

  const click = (path: string, state: GitState): void => {
    if (diff?.path === path) return setDiff(null)
    setDiff({ path, state: 'loading' })
    const same = (cur: Diff | null): boolean => cur?.path === path
    // No diff (an untracked file, or git could not answer): a file that exists opens in the editor
    const none = (): void => {
      setDiff((cur) => (!same(cur) ? cur : null))
      if (state !== 'deleted') onOpenFile(path)
    }
    void window.api.git.fileDiff(root, path).then(
      (d) => (d ? setDiff((cur) => (!same(cur) ? cur : { path, state: 'shown', ...d })) : none()),
      none
    )
  }

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
          <Button
            variant="ghost"
            className="fx-changed-row"
            title={r.path}
            aria-expanded={diff?.path === r.path && diff.state === 'shown'}
            onClick={() => click(r.path, r.state)}
          >
            <FileIcon {...resolveFileIcon(r.name)} />
            <span className={`fx-name git-${r.state}`}>{r.name}</span>
            {r.dir && <span className="fx-note">{r.dir}</span>}
            <span className={`fx-git-mark git-${r.state}`} title={t(GIT_LABEL[r.state])} aria-label={t(GIT_LABEL[r.state])}>
              {changeLetter(r.state)}
            </span>
          </Button>
          {diff?.path === r.path && diff.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={r.binary === true} />}
        </div>
      ))}
    </div>
  )
}
