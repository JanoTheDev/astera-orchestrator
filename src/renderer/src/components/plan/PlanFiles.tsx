// W6-E files tab: every affected path of the plan, the Tasks that touch it and their status, so two Tasks on one file
// show at a glance. A path opens in the file explorer; a Task selects it. The index is planBoard.ts's `filesOf`.
import type { JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskGlyph } from '../JobIcons'
import { Button } from '../ui'
import { categoryOf, filesOf } from './planBoard'
import './plan.css'

export function PlanFiles({
  tasks,
  onOpenPath,
  onSelect
}: {
  tasks: readonly JobTask[]
  /** A path as the plan wrote it, relative to the project. */
  onOpenPath?: (path: string) => void
  onSelect: (taskId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const files = filesOf(tasks)
  if (files.length === 0) return <div className="plan-files plan-files-empty">{t('plan.files.empty')}</div>
  return (
    <ul className="plan-files">
      {files.map((f) => (
        <li key={f.path} className={`plan-file${f.tasks.length > 1 ? ' plan-file-overlap' : ''}`}>
          <Button
            variant="ghost"
            size="sm"
            className="plan-file-path"
            title={t('plan.files.open')}
            disabled={!onOpenPath}
            onClick={() => onOpenPath?.(f.path)}
          >
            {f.path}
          </Button>
          {f.tasks.length > 1 && <span className="plan-file-n">{t('plan.files.overlap', { n: f.tasks.length })}</span>}
          <span className="plan-file-tasks">
            {f.tasks.map((tk) => (
              <Button
                key={tk.id}
                variant="ghost"
                size="sm"
                className={`plan-file-task plan-cat-${categoryOf(tk)}`}
                title={t(`plan.cat.${categoryOf(tk)}`)}
                onClick={() => onSelect(tk.id)}
              >
                <TaskGlyph task={tk} size={10} />
                <span>{tk.title}</span>
              </Button>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}
