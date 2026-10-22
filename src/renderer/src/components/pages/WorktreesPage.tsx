// W9-J, W11 §9: the Worktrees page: the header and the list on the left (WorktreePanel), one worktree's detail on the right.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeRow } from '../../../../core/worktrees/cleanup'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { WorktreePanel, type WorktreeListHandle } from '../WorktreePanel'
import { FolderGit2, SlidersHorizontal, X } from 'lucide-react'
import { EmptyState, IconButton, Menu } from '../ui'
import { WorktreeDetail } from '../worktrees/WorktreeDetail'
import { selectWorktree, useWorktreeView } from '../worktrees/worktreeView'

export function WorktreesPage({
  onStartSession,
  onOpenFiles,
  onClose,
  repoFilter
}: {
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  /** The page is a layer until the shell has a page tab for it (W9-B); the layer closes here. */
  onClose?: () => void
  /** Only the open project's worktrees, unless "All projects" is on. */
  repoFilter?: (repoPath: string) => boolean
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

  // Auto-clean is a setting, not a way of browsing, so it sits behind View options (DESIGN-W11 §7).
  const viewOptions = (
    <Menu
      label={t('worktrees.viewOptions')}
      align="end"
      trigger={{ icon: <SlidersHorizontal size={16} />, title: t('worktrees.viewOptions') }}
      items={[
        {
          id: 'auto-clean',
          checked: autoClean,
          label: (
            <span className="worktrees-option">
              {t('worktrees.autoClean')}
              <span className="worktrees-option__hint">{t('worktrees.autoCleanHint')}</span>
            </span>
          ),
          onSelect: () => toggleAutoClean(!autoClean)
        }
      ]}
    />
  )

  return (
    <div className="worktrees-page">
      <WorktreePanel
        ref={list}
        selected={selected}
        onSelect={selectWorktree}
        onStartSession={onStartSession}
        onRows={onRows}
        repoFilter={repoFilter}
        actions={
          <>
            {viewOptions}
            {onClose && <IconButton icon={<X size={16} />} label={t('worktrees.close')} onClick={onClose} />}
          </>
        }
      >
        <section className="worktrees-page__detail">
          {row ? (
            <WorktreeDetail row={row} list={list} onStartSession={onStartSession} onOpenFiles={onOpenFiles} />
          ) : (
            <EmptyState icon={FolderGit2} title={t('worktrees.pickTitle')}>
              {t('worktrees.pick')}
            </EmptyState>
          )}
        </section>
      </WorktreePanel>
    </div>
  )
}
