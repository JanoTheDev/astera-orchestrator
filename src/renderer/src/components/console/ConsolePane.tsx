// T10: the bottom panel's Console tab: the Astera console's chat (core/console/console.ts) in the house chat pane.
// It has no close of its own; the panel hides it.
import { ConversationPane } from '../conversation/ConversationPane'
import { Button, EmptyState, ICONS, Icon } from '../ui'
import { useConsole } from '../../state/useConsole'
import { useI18n } from '../../i18n/I18nProvider'

export function ConsolePane({ shown, onOpenPath }: { shown: boolean; onOpenPath?: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const { state, start } = useConsole(shown)
  if (state.status === 'ready')
    return (
      <div className="session-slot-view" style={{ display: 'flex' }}>
        <ConversationPane sessionId={state.sessionId} visible={shown} active={shown} cwd={state.cwd ?? undefined} onOpenPath={onOpenPath} />
      </div>
    )
  if (state.status === 'starting')
    return <EmptyState icon={ICONS.loading} title={t('shell.console.starting')} role="status" />
  const startAgain = (
    <Button size="sm" icon={<Icon name="refresh" size={14} />} onClick={start}>
      {t('shell.console.start')}
    </Button>
  )
  if (state.status === 'ended')
    return <EmptyState icon={ICONS.pending} title={t('shell.console.ended')} action={startAgain} role="status" />
  return (
    <EmptyState icon={ICONS.error} title={t('shell.console.failed')} detail={state.error} action={startAgain} role="alert" />
  )
}
