// W9-H: one card of the Finished row (DESIGN.md §4). The summary itself is W9-I's (SessionSummary, SummaryCard);
// until it lands this card says only what the app knows of an ended console: its name, Task and exit code.
// shortcut: replace with W9-I SummaryCard after merge
import { useI18n } from '../../i18n/I18nProvider'
import { Card } from '../ui'
import type { WallConsole } from './wallModel'

export function FinishedCard({ c, exitCode, onOpen }: { c: WallConsole; exitCode?: number; onOpen: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Card className="wall-finished__card" onClick={onOpen}>
      <span className="wall-finished__name">
        {c.planName ? `${c.planName} · ` : ''}
        {c.label}
      </span>
      {c.taskTitle && <span className="wall-finished__task">{c.taskTitle}</span>}
      <span className="wall-finished__outcome">{t('wall.finished.exit', { code: exitCode ?? '?' })}</span>
    </Card>
  )
}
