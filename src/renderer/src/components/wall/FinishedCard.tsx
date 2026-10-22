// W9-H: one card of the Finished row (DESIGN.md §4) while the console has no W9-I summary yet (AgentsPage shows
// SummaryCard once it is written): only what the app knows of an ended console, its name, Task and exit code.
// T13: the wall's card layout (wall.css `.wall-card`): title and exit code, meta, then the console's name.
import { useI18n } from '../../i18n/I18nProvider'
import { Card, Chip } from '../ui'
import type { WallConsole } from './wallModel'

export function FinishedCard({ c, exitCode, meta = [], onOpen }: { c: WallConsole; exitCode?: number; meta?: readonly string[]; onOpen: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Card className="wall-card" onClick={onOpen}>
      <span className="wall-card__head">
        <span className="wall-card__title">{c.taskTitle ?? c.label}</span>
        <Chip tone={exitCode === 0 ? 'ok' : exitCode === undefined ? 'neutral' : 'danger'}>{t('wall.finished.exit', { code: exitCode ?? '?' })}</Chip>
      </span>
      {meta.length > 0 && <span className="wall-card__meta">{meta.join(' · ')}</span>}
      {c.taskTitle && <span className="wall-card__line">{c.label}</span>}
    </Card>
  )
}
