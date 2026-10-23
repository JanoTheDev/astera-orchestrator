import { useI18n } from '../i18n/I18nProvider'
import { Button, Icon, IconButton } from './ui'

/** "No agent CLI installed": the strip the app shows, instead of a locked screen, once onboarding is closed with neither
 *  CLI on the machine. Install reopens the onboarding at its Tools step (the install cards); the cross dismisses it
 *  for this run. */
export function CliMissingBanner({ onInstall, onDismiss }: { onInstall: () => void; onDismiss: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="cli-banner" role="status">
      <Icon name="warning" size={14} />
      <span className="cli-banner__text">{t('cliBanner.text')}</span>
      <Button size="sm" variant="primary" onClick={onInstall}>
        {t('cliBanner.install')}
      </Button>
      <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('cliBanner.dismiss')} onClick={onDismiss} />
    </div>
  )
}
