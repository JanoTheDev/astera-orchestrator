// T14 New (DESIGN-W11 §9 "Start"): the same three ways to start as the Start page, as big cards; a console is a quiet link.
// Opened by the top bar's New (`setNewOpen`, state/useDialogs.ts), Ctrl+N (`new.open`) and the box.
import { ChevronRight, FileText, MessageCircle, Rocket, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { MessageKey } from '../../../core/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { Button, Card, Icon, Modal } from './ui'
import type { StartMode } from './pages/startLogic'
import './pages/start.css'

// The usual choice first (DESIGN-W11 notes 10-new-menu): plan with me, plan and start on its own, then prompts as written
export const CHOICES: [StartMode, LucideIcon, MessageKey, MessageKey][] = [
  ['chat', MessageCircle, 'new.chat', 'new.chatHint'],
  ['auto', Rocket, 'new.auto', 'new.autoHint'],
  ['prompts', FileText, 'new.promptsOwn', 'new.promptsOwnHint']
]

export function NewModal({ onClose, onConsole, onStart }: { onClose: () => void; onConsole: () => void; onStart: (mode: StartMode) => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal size="sm" title={t('new.title')} closeLabel={t('start.close')} onClose={onClose}>
      <div className="new-choices">
        {CHOICES.map(([id, glyph, label, hint]) => (
          <Card key={id} className="new-choice" onClick={() => onStart(id)}>
            <span className="new-choice-icon">
              <Icon icon={glyph} size={20} />
            </span>
            <span className="new-choice-text">
              <span className="new-choice-title">{t(label)}</span>
              <span className="new-choice-hint">{t(hint)}</span>
            </span>
            <Icon icon={ChevronRight} size={16} className="new-choice-go" />
          </Card>
        ))}
        <Button className="new-console" variant="ghost" icon={<SquareTerminal size={16} aria-hidden="true" />} onClick={onConsole}>
          {t('new.consoleLink')}
        </Button>
      </div>
    </Modal>
  )
}
