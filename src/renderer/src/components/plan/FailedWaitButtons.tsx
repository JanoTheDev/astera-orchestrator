// T36: the owner's three answers to a failed Task a stalled plan waits on, shared by the plan row and the plan page header.
import { useI18n } from '../../i18n/I18nProvider'
import { Button } from '../ui'

export type FailedWaitAction = 'retry' | 'accept' | 'cancel'

export function FailedWaitButtons({
  onAct,
  title,
  disabled
}: {
  onAct: (action: FailedWaitAction) => void
  /** The hover text: the failed Task's last result */
  title?: string
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <span title={title ?? t('plan.failedWait.hint')}>
      <Button size="sm" disabled={disabled} onClick={() => onAct('retry')}>
        {t('plan.failedWait.retry')}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAct('accept')}>
        {t('plan.failedWait.accept')}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAct('cancel')}>
        {t('plan.failedWait.cancel')}
      </Button>
    </span>
  )
}
