// W9-J: the Worktrees page (DESIGN.md "Worktrees"): the list on the left (WorktreePanel), one worktree's detail on the right.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeRow } from '../../../../core/worktrees/cleanup'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { WorktreePanel, type WorktreeListHandle } from '../WorktreePanel'
import { EmptyState } from '../ui'
import { WorktreeDetail } from '../worktrees/WorktreeDetail'
import { selectWorktree, useWorktreeView } from '../worktrees/worktreeView'

export function WorktreesPage({
  onStartSession,
  onOpenFiles,
  onClose
}: {
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  /** The page is a layer until the shell has a page tab for it (W9-B); the layer closes here. */
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { selected } = useWorktreeView()
  const list = useRef<WorktreeListHandle>(null)
  const [rows, setRows] = useState<WorktreeRow[]>([])
  const [autoClean, setAutoClean] = useState(true)
  const onRows = useCallback((r: WorktreeRow[]) => setRows(r), [])
  const row = rows.find((r) => r.item.path === selected)

  useEffect(() => {
    void window.api.settings.getAutoCleanWorktrees().then(setAutoClean, () => setAutoClean(true))
  }, [])
  const toggleAutoClean = (next: boolean): void => {
    setAutoClean(next)
    void window.api.settings.setAutoCleanWorktrees(next).catch((err) => {
      setAutoClean(!next)
      toast.error(t('worktrees.autoCleanFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div className="worktrees-page">
      <aside className="worktrees-page__list">
        <WorktreePanel ref={list} selected={selected} onSelect={selectWorktree} onStartSession={onStartSession} onRows={onRows} />
        <label className="worktrees-page__auto" title={t('worktrees.autoCleanHint')}>
          <input type="checkbox" checked={autoClean} onChange={(e) => toggleAutoClean(e.target.checked)} />
          <span>{t('worktrees.autoClean')}</span>
        </label>
      </aside>
      <section className="worktrees-page__detail">
        {onClose && (
          <button type="button" className="worktrees-page__close" onClick={onClose}>
            {t('worktrees.close')}
          </button>
        )}
        {row ? (
          <WorktreeDetail row={row} list={list} onStartSession={onStartSession} onOpenFiles={onOpenFiles} />
        ) : (
          <EmptyState>{t('worktrees.pick')}</EmptyState>
        )}
      </section>
    </div>
  )
}
