import type { RunStatus } from '../../../core/types'
import { labelRuns } from '../../../core/run/instances'
import { formatRunDuration } from '../../../core/run/duration'
import { exitWording } from '../../../core/sessions/exitWording'
import { useI18n } from '../i18n/I18nProvider'
import { Icon, IconButton, Select, type SelectOption } from './ui'

/** The Output tab's run selector (DESIGN-W13 §6), the left of the panel's tool row: the selected run's command and
 *  duration, then at the right a run `Select` (state dot, label — repeats of a configuration are numbered by
 *  labelRuns — and the exit code once finished), the Validation tag, the preview globe on a run that printed an
 *  address, and ✕ on a finished run (a live run is stopped from the toolbar, not closed). `now` is BottomPanel's
 *  one-second clock. With no runs the row carries the "press ▶" line. */
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
  const selected = runs.find((r) => r.runId === selectedId) ?? runs[0]
  const exitOf = (r: RunStatus): { text: string; fail: boolean } | null => {
    if (r.status !== 'exited') return null
    const w = exitWording(r.exitCode, { closedByAstera: r.closedByAstera, closeReason: r.closeReason })
    return { text: t(w.key, w.params), fail: w.tone === 'danger' }
  }
  const items: SelectOption[] = runs.map((r) => ({
    value: r.runId,
    label: labels.get(r.runId) ?? r.runId,
    ...(exitOf(r) ? { meta: exitOf(r)!.text } : {}),
    icon: <span className={`run-tab-dot ${r.status}`} title={r.status === 'stopping' ? t('run.panel.stopping') : undefined} />
  }))
  const exit = exitOf(selected)
  return (
    <div className="run-tabstrip">
      <span className="run-tabstrip-meta">
        <span className="run-tabstrip-cmd" title={selected.command}>{selected.command}</span>
        <span className="run-tabstrip-time">{formatRunDuration(selected, now)}</span>
      </span>
      {exit && <span className={`run-tab-exit${exit.fail ? ' fail' : ''}`}>{exit.text}</span>}
      {selected.validation === true && (
        <span className="run-tag" title={t('run.validation.tag')}>
          {t('run.validation.tag')}
        </span>
      )}
      {selected.status === 'running' && selected.detectedUrl !== undefined && (
        // The one place the preview is offered without knowing it exists: the address the run printed.
        <IconButton size="sm" className="run-tab-preview" icon={<Icon name="web" size={14} />} label={t('run.panel.openPreview', { url: selected.detectedUrl })} onClick={() => onOpenPreview(selected.detectedUrl as string)} />
      )}
      {selected.status === 'exited' && (
        <IconButton size="sm" className="run-tab-close" icon={<Icon name="close" size={14} />} label={t('run.panel.close')} onClick={() => onDismiss(selected.runId)} />
      )}
      <Select className="run-select" items={items} value={selected.runId} onChange={onSelect} ariaLabel={t('panel.run.select')} noCheck={false} />
    </div>
  )
}
