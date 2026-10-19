// W9-E New (DESIGN §5): a console, or a plan on the Start page in one of its two modes. Opened by the top bar's New
// (`setNewOpen`, state/useDialogs.ts), Ctrl+N (`new.open`) and the box.
import { ChevronRight, FileText, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { MessageKey } from '../../../core/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { Card, Icon, Modal } from './ui'
import type { StartMode } from './pages/startLogic'
import './pages/start.css'

// The usual choice first (DESIGN-W11 notes 10-new-menu): a plan, then prompts as written, then a bare console
const CHOICES: [StartMode | 'console', LucideIcon, MessageKey, MessageKey][] = [
  ['plan', Sparkles, 'new.plan', 'new.planHint'],
  ['prompts', FileText, 'new.prompts', 'new.promptsHint'],
  ['console', SquareTerminal, 'new.console', 'new.consoleHint']
]

export function NewModal({ onClose, onConsole, onStart }: { onClose: () => void; onConsole: () => void; onStart: (mode: StartMode) => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal size="sm" title={t('new.title')} closeLabel={t('start.close')} onClose={onClose}>
      <div className="new-choices">
        {CHOICES.map(([id, glyph, label, hint]) => (
          <Card key={id} className="new-choice" onClick={() => (id === 'console' ? onConsole() : onStart(id))}>
            <span className="new-choice-icon">
              <Icon icon={glyph} size={16} />
            </span>
            <span className="new-choice-text">
              <span className="new-choice-title">{t(label)}</span>
              <span className="new-choice-hint">{t(hint)}</span>
            </span>
            <Icon icon={ChevronRight} size={16} className="new-choice-go" />
          </Card>
        ))}
      </div>
    </Modal>
  )
}
