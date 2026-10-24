// T4 Plans page "Main plan" (plan/mainPlanView.ts): the project's plans in run order, each with its Tasks and, under a
// Task or plan that waits for another plan, one plain line. Clicking a plan opens its page; a Task opens its worker's
// console when it has one, else its plan, as the plan rows do.
// T13: a header with the overall progress and what runs, waits or needs the owner; finished plans folded to one row.
import { memo, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { STATE_KEY, TaskGlyph } from '../JobIcons'
import { Button, Chip, EmptyState, ICONS, Icon, IconButton, Meter, Switch, cx, type ChipTone } from '../ui'
import { finishedDateOf, mainPlanMemo, shownPlans, type Line, type MainPhase, type MainPlanBlock } from './mainPlanView'
import { planStatusOf } from './planList'
import type { PlanActs } from './PlanRow'
import { statusGroupOf, type StatusGroup } from './planTree'
import type { Account, JobRow, JobTask } from '../../../../core/types'
import './plans.css'
import './mainPlan.css'

const HIDE_DONE_KEY = 'cm.mainPlanHideDone'
/** The plans a person opened or folded, for the rest of the session (the tab can close and come back). */
const openByPlan = new Map<string, boolean>()

const PHASE_TONE: Record<Exclude<MainPhase, 'done'>, ChipTone> = { running: 'info', waiting: 'neutral', needs: 'warn' }
const GROUP_TONE: Record<StatusGroup, ChipTone> = { needs: 'warn', running: 'info', waiting: 'neutral', done: 'ok', failed: 'danger' }

function storedHideDone(): boolean {
  try {
    return localStorage.getItem(HIDE_DONE_KEY) === '1'
  } catch {
    return false
  }
}

const anchorOf = (id: string): string => `mainplan-${id}`

export const MainPlan = memo(function MainPlan({ rows, acts, accounts = [] }: { rows: readonly JobRow[]; acts: PlanActs; accounts?: readonly Account[] }): React.JSX.Element {
  const { t, lang } = useI18n()
  const [hideDone, setHideDone] = useState(storedHideDone)
  const [, setOpenTick] = useState(0)
  const view = mainPlanMemo(rows)
  const say = (l: Line): string => t(l.key, l.params)
  if (view.plans.length === 0) return <EmptyState icon={ICONS.tasks} title={t('pages.plans.main.empty')} />

  const plans = shownPlans(view, hideDone)
  const nowMs = Date.now()
  const accountLabel = (id: string): string => accounts.find((a) => a.id === id)?.label ?? id
  const isOpen = (p: MainPlanBlock): boolean => openByPlan.get(p.row.id) ?? p.open
  const setOpen = (id: string, open: boolean): void => {
    openByPlan.set(id, open)
    setOpenTick((n) => n + 1)
  }
  const chooseHideDone = (on: boolean): void => {
    setHideDone(on)
    try {
      localStorage.setItem(HIDE_DONE_KEY, on ? '1' : '0')
    } catch {
      // storage refused: the toggle still holds for this view
    }
  }
  const jumpTo = (phase: MainPhase): void => {
    const first = view.plans.find((p) => p.phase === phase)
    if (first) document.getElementById(anchorOf(first.row.id))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const taskRow = (task: JobTask, row: JobRow): React.JSX.Element => {
    const sessionId = task.sessionId && acts.canOpenSession(task.sessionId) ? task.sessionId : undefined
    const group = statusGroupOf(task)
    const account = task.accountId ?? task.accountIds?.[0]
    const model = [task.model, task.effort].filter(Boolean).join(' · ')
    return (
      <Button
        variant="ghost"
        size="sm"
        className="plans-main__trow"
        title={task.title}
        onClick={() => (sessionId ? acts.onOpenSession(sessionId) : acts.onOpen(row.id))}
      >
        <TaskGlyph task={task} size={14} />
        <span className="plans-main__ttitle">{task.title}</span>
        <span className="plans-main__tstatus" title={t(STATE_KEY[task.status])}>
          <Chip tone={GROUP_TONE[group]}>{t(`pages.plans.tree.status.${group}`)}</Chip>
        </span>
        <span className="plans-main__tcell">{account !== undefined ? accountLabel(account) : ''}</span>
        <span className="plans-main__tcell plans-main__tmodel">{model}</span>
      </Button>
    )
  }

  return (
    <div className="plans-list plans-main">
      <header className="plans-main__header">
        <h2 className="plans-main__head">{t('pages.plans.main.head', { plans: view.plans.length, done: view.done, total: view.total })}</h2>
        <Meter className="plans-main__meter" value={view.total > 0 ? (view.done / view.total) * 100 : 0} label={t('pages.plans.main.count', { done: view.done, total: view.total })} />
        <div className="plans-main__bar">
          {(['running', 'waiting', 'needs'] as const)
            .filter((phase) => view.counts[phase] > 0)
            .map((phase) => (
              <Button key={phase} variant="ghost" size="sm" className="plans-main__jump" onClick={() => jumpTo(phase)}>
                <Chip tone={PHASE_TONE[phase]} dot>
                  {t(`pages.plans.main.${phase}`, { n: view.counts[phase] })}
                </Chip>
              </Button>
            ))}
          <span className="plans-row__spacer" />
          <label className="plans-main__hide">
            <Switch checked={hideDone} onChange={chooseHideDone} />
            {t('pages.plans.main.hideDone')}
          </label>
        </div>
      </header>
      {plans.length === 0 && <p className="plans-row__facts plans-main__none">{t('pages.plans.main.allDone')}</p>}
      {plans.map((p) => {
        const { row, name, tasks, checks, finished } = p
        const open = isOpen(p)
        const status = planStatusOf(row)
        return (
          <section key={row.id} id={anchorOf(row.id)} className={cx('plans-main__plan', finished && 'is-finished')}>
            <div className="plans-row__main">
              <IconButton
                size="sm"
                icon={<Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />}
                label={t('pages.plans.main.toggle', { plan: name })}
                aria-expanded={open}
                onClick={() => setOpen(row.id, !open)}
              />
              <Button variant="ghost" className="plans-row__name" title={name} onClick={() => acts.onOpen(row.id)}>
                {name}
              </Button>
              <Chip tone={status.tone}>{t(status.key, status.params)}</Chip>
              {!finished && row.areas?.length ? <span className="plans-row__facts plans-main__areas">{row.areas.join(' · ')}</span> : null}
              <span className="plans-row__spacer" />
              <span className="plans-row__meta">
                {finished
                  ? [
                      t('pages.plans.main.tasks', { n: finished.tasks }),
                      finished.commit,
                      finished.at !== undefined ? finishedDateOf(finished.at, nowMs, lang) : undefined
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('pages.plans.main.count', { done: row.done, total: row.total })}
              </span>
            </div>
            {open && (
              <>
                {checks && (
                  <p className={cx('plans-main__wait', checks.failed && 'plans-main__wait--failed')}>
                    <Icon name={checks.failed ? 'error' : 'waiting'} size={14} />
                    {say(checks)}
                  </p>
                )}
                {tasks.length === 0 && <p className="plans-row__facts plans-main__none">{t('pages.plans.main.noTasks')}</p>}
                {tasks.map(({ task, wait }) => (
                  <div key={task.id} className="plans-main__task">
                    {taskRow(task, row)}
                    {wait && (
                      <p className="plans-main__wait">
                        <Icon name="waiting" size={14} />
                        {say(wait)}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
        )
      })}
    </div>
  )
})
