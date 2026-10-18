// W9-E New (DESIGN §5): a console, or a plan on the Start page in one of its two modes. Opened by the top bar's New
// (`setNewOpen`, state/useDialogs.ts), Ctrl+N (`new.open`) and the box.
import { FileText, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { MessageKey } from '../../../core/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { Card, Icon, Modal } from './ui'
import type { StartMode } from './pages/startLogic'
import './pages/start.css'

const CHOICES: [StartMode | 'console', LucideIcon, MessageKey, MessageKey][] = [
  ['console', SquareTerminal, 'new.console', 'new.consoleHint'],
  ['plan', Sparkles, 'new.plan', 'new.planHint'],
  ['prompts', FileText, 'new.prompts', 'new.promptsHint']
]

export function NewModal({ onClose, onConsole, onStart }: { onClose: () => void; onConsole: () => void; onStart: (mode: StartMode) => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal size="sm" title={t('new.title')} closeLabel={t('start.close')} onClose={onClose}>
      <div className="new-choices">
        {CHOICES.map(([id, glyph, label, hint]) => (
          <Card key={id} onClick={() => (id === 'console' ? onConsole() : onStart(id))}>
            <Icon icon={glyph} size={20} />
            <span className="new-choice-title">{t(label)}</span>
            <span className="new-choice-hint">{t(hint)}</span>
          </Card>
        ))}
      </div>
    </Modal>
  )
}
