// The Files page's Changed view (a flat list of the changed files). A plan's worktree lists the files changed against its
// base branch as well as the uncommitted ones, and a click shows the diff read by readFileDiff (worktrees.fileDiff);
// elsewhere the list is git's status and a click opens the file.
import { useEffect, useMemo, useState } from 'react'
import type { ChangedFile } from '../../../core/git/changedFile'
import { resolveFileIcon } from '../../../core/files/icons'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useI18n } from '../i18n/I18nProvider'
import { DiffView } from './DiffView'
import { GIT_LABEL, GIT_MARK } from './ExplorerRow'
import { FileIcon } from './FileIcon'
import { EmptyState } from './ui'
import { changedRows } from './explorerChanged'
import { ROW_H } from './explorerRows'
import { Check } from 'lucide-react'

type Diff = { path: string } & ({ state: 'loading' } | { state: 'shown'; diff: string; truncated: boolean } | { state: 'failed' })

export function ChangedList({ root, gitStatus, onOpenFile }: { root: string; gitStatus: GitStatusMap; onOpenFile: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const [wt, setWt] = useState<{ id: string; files: ChangedFile[] } | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const { fileState } = gitStatus

  // Read again whenever the git status changed: the same refresh the badges use
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const w = (await window.api.worktrees.list()).find((x) => x.path === root && x.status === 'ok')
        const d = w ? await window.api.worktrees.detail(w.id) : null
        if (alive) setWt(w && d?.files ? { id: w.id, files: d.files } : null)
      } catch {
        if (alive) setWt(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [root, fileState])
  useEffect(() => setDiff(null), [root])

  const rows = useMemo(() => changedRows(root, fileState, wt?.files ?? null), [root, fileState, wt])

  const click = (path: string, fileId?: string): void => {
    if (!fileId || !wt) return onOpenFile(path)
    if (diff?.path === path) return setDiff(null)
    setDiff({ path, state: 'loading' })
    const same = (cur: Diff | null): boolean => cur?.path === path
    void window.api.worktrees.fileDiff(wt.id, fileId).then(
      (d) => setDiff((cur) => (!same(cur) ? cur : d ? { path, state: 'shown', ...d } : { path, state: 'failed' })),
      () => setDiff((cur) => (!same(cur) ? cur : { path, state: 'failed' }))
    )
  }

  if (rows.length === 0) return <EmptyState icon={Check} title={t('explorer.changed.empty')} />
  return (
    <div className={`fx-tree${gitStatus.stale ? ' git-stale' : ''}`}>
      {rows.map((r) => (
        <div key={r.path}>
          <div className="fx-row file" style={{ height: ROW_H }} title={r.path} onClick={() => click(r.path, r.fileId)}>
            <FileIcon {...resolveFileIcon(r.name)} />
            <span className={`fx-name git-${r.state}`}>{r.name}</span>
            {r.dir && <span className="fx-note">{r.dir}</span>}
            <span className={`fx-git-mark git-${r.state}`} title={t(GIT_LABEL[r.state])} aria-label={t(GIT_LABEL[r.state])}>
              {GIT_MARK[r.state]}
            </span>
          </div>
          {diff?.path === r.path && diff.state === 'shown' && <DiffView diff={diff.diff} truncated={diff.truncated} binary={r.binary === true} />}
          {diff?.path === r.path && diff.state === 'failed' && <p className="modal-hint">{t('jobs.changes.failed', { message: '' })}</p>}
        </div>
      ))}
    </div>
  )
}
