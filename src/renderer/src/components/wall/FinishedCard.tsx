// W9-H: one card of the Finished row (DESIGN.md §4) while the console has no W9-I summary yet (AgentsPage shows
// SummaryCard once it is written): only what the app knows of an ended console, its name, Task and exit code.
import { exitStatusOf } from '../../../../core/sessions/exitStatus'
import { useI18n } from '../../i18n/I18nProvider'
import { Card, Chip } from '../ui'
import type { WallConsole } from './wallModel'

export function FinishedCard({ c, exitCode, account, onOpen }: { c: WallConsole; exitCode?: number; account?: string; onOpen: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const status = exitCode === undefined ? null : exitStatusOf(exitCode)
  return (
    <Card className="wall-finished__card" onClick={onOpen}>
      <span className="wall-finished__head">
        <span className="wall-finished__name">{c.label}</span>
        <Chip tone={status ? (status.tone === 'muted' ? 'neutral' : status.tone) : 'neutral'}>{status ? t(status.key, status.params) : '?'}</Chip>
      </span>
      {c.taskTitle && <span className="wall-finished__task">{c.taskTitle}</span>}
      {account && <span className="wall-finished__meta">{account}</span>}
    </Card>
  )
}
