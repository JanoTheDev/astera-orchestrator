// W9-H: one card of the Finished row (DESIGN.md §4) while the console has no W9-I summary yet (AgentsPage shows
// SummaryCard once it is written): only what the app knows of an ended console, its name, Task and exit code.
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
