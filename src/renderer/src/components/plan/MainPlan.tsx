// T4 Plans page "Main plan" (plan/mainPlanView.ts): the project's plans in run order, each with its Tasks and, under a
// Task or plan that waits for another plan, one plain line. Clicking a plan opens its page; a Task opens its worker's
// console when it has one, else its plan, as the plan rows do.
import { useI18n } from '../../i18n/I18nProvider'
import { STATE_KEY, TaskGlyph } from '../JobIcons'
import { Button, Chip, EmptyState, ICONS, Icon } from '../ui'
import { mainPlanViewOf, type Line } from './mainPlanView'
import { planStatusOf } from './planList'
import type { PlanActs } from './PlanRow'
import type { JobRow } from '../../../../core/types'
import './plans.css'

export function MainPlan({ rows, acts }: { rows: readonly JobRow[]; acts: PlanActs }): React.JSX.Element {
  const { t } = useI18n()
  const view = mainPlanViewOf(rows)
  const say = (l: Line): string => t(l.key, l.params)
  if (view.plans.length === 0) return <EmptyState icon={ICONS.tasks} title={t('pages.plans.main.empty')} />
  return (
    <div className="plans-list plans-main">
      <h2 className="plans-main__head">{t('pages.plans.main.head', { plans: view.plans.length, done: view.done, total: view.total })}</h2>
      {view.plans.map(({ row, name, tasks, checks }) => (
        <section key={row.id} className="plans-main__plan">
          <div className="plans-row__main">
            <Button variant="ghost" className="plans-row__name" title={name} onClick={() => acts.onOpen(row.id)}>
              {name}
            </Button>
            <Chip tone={planStatusOf(row).tone}>{t(planStatusOf(row).key, planStatusOf(row).params)}</Chip>
            {row.areas?.length ? <span className="plans-row__facts">{row.areas.join(' · ')}</span> : null}
            <span className="plans-row__spacer" />
            <span className="plans-row__meta">{t('pages.plans.main.count', { done: row.done, total: row.total })}</span>
          </div>
          {checks && (
            <p className="plans-main__wait">
              <Icon name="waiting" size={14} />
              {say(checks)}
            </p>
          )}
          {tasks.length === 0 && <p className="plans-row__facts plans-main__none">{t('pages.plans.main.noTasks')}</p>}
          {tasks.map(({ task, wait }) => {
            const sessionId = task.sessionId && acts.canOpenSession(task.sessionId) ? task.sessionId : undefined
            return (
              <div key={task.id} className="plans-main__task">
                <Button
                  variant="ghost"
                  size="sm"
                  className="plans-row__worker"
                  onClick={() => (sessionId ? acts.onOpenSession(sessionId) : acts.onOpen(row.id))}
                >
                  <TaskGlyph task={task} />
                  <span className="plans-row__text" title={task.title}>
                    {task.title}
                  </span>
                  <span className="plans-row__meta">{t(STATE_KEY[task.status])}</span>
                </Button>
                {wait && (
                  <p className="plans-main__wait">
                    <Icon name="waiting" size={14} />
                    {say(wait)}
                  </p>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
