import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../../../core/i18n'
import { Card, Icon, type IconName } from '../ui'
import { PROJECT_CHOICES, type ProjectChoice } from './onboardingModel'
import './onboarding.css'

const CHOICES: Record<ProjectChoice, { icon: IconName; name: MessageKey; hint: MessageKey }> = {
  open: { icon: 'folder', name: 'onboarding.start.open', hint: 'onboarding.start.openHint' },
  clone: { icon: 'branch', name: 'onboarding.start.clone', hint: 'onboarding.start.cloneHint' },
  new: { icon: 'add', name: 'onboarding.start.new', hint: 'onboarding.start.newHint' }
}

/** The three ways to get a project (open a folder, clone, create), shared by the onboarding step and the empty Welcome. */
export function GetStarted({ onChoose }: { onChoose?: (choice: ProjectChoice) => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="get-started">
      {PROJECT_CHOICES.map((c) => (
        <Card
          key={c}
          className="get-started__card"
          onClick={() => onChoose?.(c)}
          disabled={!onChoose}
          aria-label={t(CHOICES[c].name)}
        >
          <span className="get-started__name">
            <Icon name={CHOICES[c].icon} />
            {t(CHOICES[c].name)}
          </span>
          <span className="get-started__hint">{t(CHOICES[c].hint)}</span>
        </Card>
      ))}
    </div>
  )
}
