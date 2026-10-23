import type { RunStatus } from '../../../core/types'
import { labelRuns } from '../../../core/run/instances'
import { formatRunDuration } from '../../../core/run/duration'
import { exitWording } from '../../../core/sessions/exitWording'
import { useI18n } from '../i18n/I18nProvider'
import { Icon, IconButton, nextFocusIndex } from './ui'

/** The tab strip above the console: one tab per run of the current project, in seat order — state dot,
 *  label (repeats of a configuration are numbered by labelRuns), exit code once finished, the Validation
 *  tag, and ✕ on a finished run (a live run is stopped from the rail, not closed). At the right end, the
 *  selected run's command and its duration; `now` is BottomPanel's one-second clock. With no runs the
 *  strip carries the "press ▶" line. */
export function RunTabStrip({
  runs,
  selectedId,
  now,
  onSelect,
  onDismiss,
  onOpenPreview
}: {
  runs: RunStatus[]
  selectedId: string | null
  now: number
  onSelect: (runId: string) => void
  onDismiss: (runId: string) => void
  /** Open a running server's page in a preview tab. Offered only on runs that printed an address. */
  onOpenPreview: (url: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  if (runs.length === 0) return <div className="run-tabstrip run-tabstrip-empty" role="note" aria-label={t('run.panel.tab')}>{t('run.panel.empty')}</div>
  const labels = new Map(labelRuns(runs).map((l) => [l.runId, l.label]))
  const selected = runs.find((r) => r.runId === selectedId) ?? null
  // The one tab in the Tab order (roving tabindex): the selected run, or the first when none is selected
  const rovingId = selected?.runId ?? runs[0].runId
  // A tab holds a button, so it is a span with role=tab (no button inside a button) — the same reason
  // the bottom tabs are spans. Enter/Space select; arrows, Home and End move focus over the tabs; a key
  // from the nested ✕ is left to that button.
  const tabKeyDown =
    (runId: string) =>
    (e: React.KeyboardEvent): void => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(runId)
        return
      }
      const list = e.currentTarget.parentElement
      const rows = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
      const next = nextFocusIndex(rows.indexOf(e.currentTarget as HTMLElement), rows.length, e.key, 'horizontal')
      if (next === null) return
      e.preventDefault()
      rows[next]?.focus()
    }
  return (
    <div className="run-tabstrip">
      <div className="run-tabs" role="tablist" aria-label={t('run.panel.tab')}>
        {runs.map((r) => (
          <span
            key={r.runId}
            role="tab"
            aria-selected={r.runId === selectedId}
            tabIndex={r.runId === rovingId ? 0 : -1}
            className={`run-tab${r.runId === selectedId ? ' on' : ''}`}
            onClick={() => onSelect(r.runId)}
            onKeyDown={tabKeyDown(r.runId)}
          >
            <span className={`run-tab-dot ${r.status}`} title={r.status === 'stopping' ? t('run.panel.stopping') : undefined} />
            <span className="run-tab-label">{labels.get(r.runId)}</span>
            {r.validation === true && (
              <span className="run-tag" title={t('run.validation.tag')}>
                {t('run.validation.tag')}
              </span>
            )}
            {r.status === 'running' && r.detectedUrl !== undefined && (
              // The one place the preview is offered without knowing it exists: the address the run
              // printed, one click from the tab the user is already looking at after pressing ▶.
              <IconButton
                className="run-tab-preview"
                size="sm"
                icon={<Icon name="web" size={14} />}
                label={t('run.panel.openPreview', { url: r.detectedUrl })}
                onClick={(e) => {
                  e.stopPropagation() // opening the preview must not also change the selected run
                  onOpenPreview(r.detectedUrl as string)
                }}
              />
            )}
            {r.status === 'exited' && (
              <span className={`run-tab-exit${exitWording(r.exitCode, { closedByAstera: r.closedByAstera, closeReason: r.closeReason }).tone === 'danger' ? ' fail' : ''}`}>
                {t(exitWording(r.exitCode, { closedByAstera: r.closedByAstera, closeReason: r.closeReason }).key, exitWording(r.exitCode, { closedByAstera: r.closedByAstera, closeReason: r.closeReason }).params)}
              </span>
            )}
            {r.status === 'exited' && (
              <IconButton
                className="run-tab-close"
                size="sm"
                icon={<Icon name="close" size={14} />}
                label={t('run.panel.close')}
                onClick={(e) => {
                  e.stopPropagation() // keeps close from also selecting the tab
                  onDismiss(r.runId)
                }}
              />
            )}
          </span>
        ))}
      </div>
      {selected && (
        <span className="run-tabstrip-meta">
          <span className="run-tabstrip-cmd" title={selected.command}>{selected.command}</span>
          <span className="run-tabstrip-time">{formatRunDuration(selected, now)}</span>
        </span>
      )}
    </div>
  )
}
