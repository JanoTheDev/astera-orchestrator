import type { RunStatus } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { Icon, IconButton } from './ui'

/** The vertical tool rail on the console's left, acting on the selected run: rerun · stop, then
 *  scroll-to-end · clear, then find. Rerun starts the run's configuration again (main decides whether
 *  that restarts a live instance or adds one — the same call the toolbar's ▶ makes); stop is enabled
 *  only while the run is running. Everything is disabled with no run selected. */
export function RunToolRail({
  run,
  rerunGone,
  findOpen,
  onRerun,
  onStop,
  onScrollToEnd,
  onClear,
  onToggleFind
}: {
  run: RunStatus | null
  /** The run's configuration was deleted since it started: ↻ has nowhere to go, so it is disabled with
   *  the reason as its tooltip. Before this, run.start failed with NO_CONFIG behind a button that
   *  appeared to do nothing. */
  rerunGone: boolean
  findOpen: boolean
  onRerun: (configId: string) => void
  onStop: (runId: string) => void
  onScrollToEnd: () => void
  onClear: () => void
  onToggleFind: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const none = run === null
  return (
    <div className="run-rail" role="toolbar" aria-orientation="vertical" aria-label={t('run.panel.tab')}>
      {/* label is the name; title (set after it) keeps the deleted-configuration reason as the hover text */}
      <IconButton
        size="sm"
        className="run-rail-btn rerun"
        icon={<Icon name="rerun" size={14} />}
        label={t('run.action.rerun')}
        title={rerunGone ? t('run.rail.rerunGone') : t('run.action.rerun')}
        disabled={none || rerunGone}
        onClick={() => run && onRerun(run.configId)}
      />
      <IconButton size="sm" className="run-rail-btn stop" icon={<Icon name="stop" size={14} />} label={t('run.action.stop')} disabled={run?.status !== 'running'} onClick={() => run && onStop(run.runId)} />
      <span className="run-rail-sep" />
      <IconButton size="sm" icon={<Icon name="scrollToEnd" size={14} />} label={t('run.rail.scrollToEnd')} disabled={none} onClick={onScrollToEnd} />
      <IconButton size="sm" icon={<Icon name="clear" size={14} />} label={t('run.panel.clear')} disabled={none} onClick={onClear} />
      <span className="run-rail-sep" />
      <IconButton size="sm" icon={<Icon name="search" size={14} />} label={t('run.rail.find')} active={findOpen} aria-pressed={findOpen} disabled={none} onClick={onToggleFind} />
    </div>
  )
}
