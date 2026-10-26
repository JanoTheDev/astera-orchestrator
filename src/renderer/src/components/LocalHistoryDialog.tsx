import { useEffect, useRef, useState } from 'react'
import type { LocalHistoryEntry } from '../../../core/types'
import { errText } from '../hooks/useFileOps'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { historyForFile } from './explorerMenu'
import { Button, EmptyState, ICONS, Modal, Skeleton } from './ui'
import './sessionDialog.css'

/** Byte size in human-readable units. This repo has no shared size formatter (checked by grep), so it
 *  stays a local helper used only in this file — extracting it into a pure module and registering that
 *  in tsconfig.web.json was judged not worth the reuse. */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`
}

/** Deletion timestamp display. Follows HistoryBrowser's .project-meta convention exactly (month/day/hour/minute). */
function formatDeletedAt(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** The original file name — split on the separator without node:path (the same convention as nameOf and copyPath in useFileOps.ts). */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** Local History browse and restore modal. Shows the deletion snapshots files.remove left behind,
 *  grouped per project, and puts a selected item back in its original location. The list-modal
 *  conventions follow ResumeDialog (the null-while-loading pattern, outside click / stopPropagation) and
 *  AccountPanel's detect dialog (the .detect-list style layout). Escape, the focus trap and focus return are Modal's. */
export function LocalHistoryDialog({
  projectPath,
  file,
  onRestored,
  onClose
}: {
  projectPath: string
  /** Lists only this file's snapshots (opened from a file's menu). */
  file?: string
  onRestored: (path: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<LocalHistoryEntry[] | null>(null) // null = still loading
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.localHistory
      .list(projectPath)
      .then((list) => {
        if (cancelled) return
        // Descending by deletion time — the most recently deleted goes on top
        setEntries([...historyForFile(list, file)].sort((a, b) => b.deletedAt - a.deletedAt))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toast.error(t('localHistory.listFailed', { detail: errText(err) }))
        setEntries([]) // substitute an empty list so it does not get stuck on 'loading…'
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, file])

  const doRestore = async (id: string | null = selectedId): Promise<void> => {
    if (!id || restoring) return
    setRestoring(true)
    try {
      const restoredPath = await window.api.localHistory.restore(projectPath, id)
      // On a name collision the store uses the name it fell back to, so it can differ from the name the
      // user picked — showing the actual return value verbatim is what keeps this from lying.
      toast.success(t('localHistory.restored', { path: restoredPath }))
      onRestored(restoredPath)
    } catch (err) {
      // main (localHistory.restore in ipc.ts) already translates LOCAL_HISTORY_NOT_FOUND through
      // t(core.lang, …) before throwing, so there is no code check here and it is always wrapped as
      // detail — translating once in main means both consumers, this dialog and undo() in useFileOps,
      // get the same handling
      toast.error(t('localHistory.restoreFailed', { detail: errText(err) }))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Modal
      title="Local History"
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!selectedId || restoring} onClick={() => void doRestore()}>
            {restoring ? t('localHistory.restoring') : t('localHistory.restore')}
          </Button>
        </>
      }
    >
      <div className="sd-body">
        {entries === null ? (
          <div aria-busy="true" aria-label={t('localHistory.loading')}>
            <Skeleton width="70%" />
            <Skeleton width="55%" />
            <Skeleton width="62%" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={ICONS.history} title={t('localHistory.empty')}>
            {t('localHistory.emptyHint')}
          </EmptyState>
        ) : (
          // Arrows move between the rows, Enter or a double click restores the one picked
          <ul
            className="lh-list"
            onKeyDown={(ev) => {
              const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0
              if (!step) return
              const rows = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>('.lh-row'))
              const next = rows[rows.indexOf(document.activeElement as HTMLButtonElement) + step]
              if (!next) return
              ev.preventDefault()
              next.focus()
              next.click()
            }}
          >
            {entries.map((entry) => {
              const name = baseName(entry.originalPath) + (entry.isDir ? '/' : '')
              const relPath = entry.originalPath.slice(projectPath.length).replace(/^[\\/]/, '')
              return (
                <li key={entry.id}>
                  <Button
                    variant="ghost"
                    className={`lh-row${selectedId === entry.id ? ' selected' : ''}`}
                    aria-pressed={selectedId === entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    onDoubleClick={() => {
                      setSelectedId(entry.id)
                      void doRestore(entry.id)
                    }}
                  >
                    <span className="lh-main">
                      <span className="lh-name">{name}</span>
                      <span className="lh-path" title={relPath}>
                        {relPath}
                      </span>
                    </span>
                    <span className="lh-meta">{formatSize(entry.size)}</span>
                    <span className="lh-meta">{formatDeletedAt(entry.deletedAt)}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
