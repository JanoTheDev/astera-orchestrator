// W9-C Tasks page, W11 look (DESIGN-W11 §9 "Tasks"): every Task of the project across plans, in five columns, with a
// plan filter; plans still being planned come first, and a waiting card names what it waits on.
// A card's column, its live line and where a click goes are planBoard.ts's (taskColumnOf, nowOf, reasonText, taskClickOf);
// the "why it waits" is core's taskBoardsOf, carried on JobTask.board.
import { useEffect, useMemo, useState } from 'react'
import type { JobRow, JobTask } from '../../../../core/types'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import type { AppState } from '../../state/appState'
import { localDoor } from '../../lib/orchDoor'
import { jobName } from '../../lib/jobName'
import { openConsole, openInbox, openPlan } from '../shell/navigation'
import { ListTodo, Plus, SquareTerminal } from 'lucide-react'
import { Button, Card, Chip, EmptyState, PageHeader, Select, type ChipTone } from '../ui'
import {
  DONE_PER_PLAN,
  TASK_COLUMNS,
  nowOf,
  questionsOfTask,
  reasonText,
  taskClickOf,
  taskColumnOf,
  type LiveSession,
  type TaskColumn
} from '../plan/planBoard'
import { planningEntriesOf, stageText, waitKindOf, type WaitKind } from './tasksPlanning'
import { usePlanLive } from '../plan/usePlanLive'
import { TaskGlyph } from '../JobIcons'
import '../plan/plan.css'

const COLUMN_KEY = {
  planned: 'pages.tasks.col.planned',
  working: 'pages.tasks.col.working',
  'needs-you': 'pages.tasks.col.needsYou',
  review: 'pages.tasks.col.review',
  done: 'pages.tasks.col.done'
} as const

/** How often the "… ago" lines refresh. */
const TICK_MS = 5_000

type Placed = { task: JobTask; plan: JobRow; column: TaskColumn }

export type TasksPageProps = Pick<AppState, 'accounts' | 'currentProject' | 'layout' | 'openStart' | 'orchSnapshot' | 't'>

export function TasksPage({ accounts, currentProject, layout, openStart, orchSnapshot, t }: TasksPageProps): React.JSX.Element {
  const [planFilter, setPlanFilter] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  const door = useMemo(() => (currentProject ? localDoor(window.api, currentProject) : null), [currentProject])
  // The Host's word on each worker (a prompt waiting) and the open asks: both put a card under "Needs you"
  const live = usePlanLive(door ?? NO_DOOR, door !== null)
  const canOpenSession = (id: string): boolean => !!layout && !!groupOfTab(layout, sessionTab(id))
  const label = (id: string): string => accounts.find((a) => a.id === id)?.label ?? id

  const plans = (orchSnapshot?.runs ?? []).filter((r) => r.archivedAt === undefined && !r.schedule)
  const planning = planningEntriesOf(plans)
  const planningIds = new Set(planning.map((e) => e.plan.id))
  const shown = planFilter === null ? plans : plans.filter((r) => r.id === planFilter)
  const columns = new Map<TaskColumn, Placed[]>(TASK_COLUMNS.map((c) => [c, []]))
  let olderDone = 0
  for (const plan of shown) {
    const done: Placed[] = []
    for (const task of plan.tasks) {
      const session: LiveSession | undefined = task.sessionId ? live.sessions[task.sessionId] : undefined
      const column = taskColumnOf(task, session, questionsOfTask(live.questions, task.id).length > 0)
      if (column === 'done') done.push({ task, plan, column })
      else columns.get(column)?.push({ task, plan, column })
    }
    // Done keeps the last DONE_PER_PLAN per plan (Tasks are in creation order); older ones are under the plan's page
    olderDone += Math.max(0, done.length - DONE_PER_PLAN)
    columns.get('done')?.push(...done.slice(-DONE_PER_PLAN))
  }

  const liveLine = ({ task }: Placed): string | null => {
    const now = nowOf(task, task.sessionId ? live.sessions[task.sessionId] : undefined, [], nowMs)
    if (now) return t(now.key, now.params)
    if (task.board?.reason) {
      const r = reasonText(task.board.reason, nowMs, label)
      return t(r.key, r.params)
    }
    return task.gate?.question ?? null
  }
  const go = (p: Placed): void => {
    const click = taskClickOf(p.column, p.task, p.plan.id, canOpenSession)
    if (click.kind === 'console') openConsole(click.sessionId)
    else if (click.kind === 'inbox') openInbox(click.filter)
    else openPlan(click.jobId, click.section)
  }

  const cardCount = TASK_COLUMNS.reduce((n, c) => n + (columns.get(c)?.length ?? 0), 0)
  const newTask = (): void => {
    if (currentProject) openStart({})
  }
  return (
    <div className="plan-pages tasks-page">
      <PageHeader
        title={t('pages.tasks.title')}
        subtitle={cardCount > 0 ? t('pages.tasks.count', { count: cardCount }) : undefined}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} disabled={!currentProject} onClick={newTask}>
            {t('pages.tasks.new')}
          </Button>
        }
        filters={
          plans.length > 0 && (
            <Select
              className="tasks-plan-filter"
              aria-label={t('pages.tasks.allPlans')}
              value={planFilter ?? ''}
              onChange={(e) => setPlanFilter(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">{t('pages.tasks.allPlans')}</option>
              {plans.map((r) => (
                <option key={r.id} value={r.id}>
                  {jobName(r)} · {planningIds.has(r.id) ? t('pages.tasks.planning.badge') : `${r.done}/${r.total}`}
                </option>
              ))}
            </Select>
          )
        }
      />
      {planning.length > 0 && (
        <section className="tasks-planning" aria-label={t('pages.tasks.planning.title')}>
          <h2 className="tasks-section-head">
            {t('pages.tasks.planning.title')}
            <span className="tasks-col-count">{planning.length}</span>
          </h2>
          <div className="tasks-planning-row">
            {planning.map((e) => {
              const stage = stageText(e)
              return (
                <Card key={e.plan.id} tone={e.stage === 'ready' ? 'need' : 'plain'} className="tasks-card tasks-planning-card" onClick={() => openPlan(e.plan.id)}>
                  <span className="tasks-card-title" title={jobName(e.plan)}>
                    {jobName(e.plan)}
                  </span>
                  <span className="tasks-card-line">
                    <Chip tone={e.stage === 'ready' ? 'warn' : 'info'} dot>
                      {t(stage.key, stage.params)}
                    </Chip>
                  </span>
                  <span className="tasks-card-meta">
                    <span>{t('pages.tasks.planning.written', { count: e.plan.total })}</span>
                    {e.plan.plannerSessionId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<SquareTerminal size={14} />}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          openConsole(e.plan.plannerSessionId as string)
                        }}
                      >
                        {t('pages.tasks.planning.console')}
                      </Button>
                    )}
                  </span>
                </Card>
              )
            })}
          </div>
        </section>
      )}
      {cardCount === 0 && planning.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={t('pages.tasks.emptyTitle')}
          action={
            <Button variant="primary" icon={<Plus size={16} />} disabled={!currentProject} onClick={newTask}>
              {t('pages.tasks.new')}
            </Button>
          }
        >
          {t('pages.tasks.emptyText')}
        </EmptyState>
      ) : (
        <div className="tasks-board">
          {TASK_COLUMNS.map((c) => {
            const cards = columns.get(c) ?? []
            return (
              <section key={c} className={`tasks-col tasks-col--${c}`} aria-label={t(COLUMN_KEY[c])}>
                <h2 className="tasks-col-head">
                  {t(COLUMN_KEY[c])}
                  <span className="tasks-col-count">{cards.length}</span>
                </h2>
                <div className="tasks-col-cards">
                  {cards.map((p) => {
                    const line = liveLine(p)
                    const wait = c === 'planned' ? waitKindOf(p.task.board?.reason) : null
                    const tone = c !== 'needs-you' ? 'plain' : p.task.status === 'failed' ? 'danger' : 'need'
                    return (
                      <Card key={`${p.plan.id}:${p.task.id}`} tone={tone} className="tasks-card" onClick={() => go(p)}>
                        <span className="tasks-card-head">
                          <TaskGlyph task={p.task} />
                          <span className="tasks-card-title" title={p.task.title}>
                            {p.task.title}
                          </span>
                          <span className="tasks-card-id">{p.task.id.slice(-6)}</span>
                        </span>
                        {(wait || line) && (
                          <span className="tasks-card-why">
                            {wait && <Chip tone={WAIT_TONE[wait]}>{t(WAIT_KEY[wait])}</Chip>}
                            {line && (
                              <span className="tasks-card-line" title={line}>
                                {line}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="tasks-card-meta">
                          {planFilter === null && <span className="tasks-card-plan">{jobName(p.plan)}</span>}
                          {p.task.provider && <span>{p.task.provider}</span>}
                          {p.task.model && <span>{p.task.model}</span>}
                        </span>
                      </Card>
                    )
                  })}
                  {c === 'done' && olderDone > 0 && <p className="tasks-col-note">{t('pages.tasks.olderDone', { count: olderDone })}</p>}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The tag before a waiting card's reason: what kind of thing it waits on (tasksPlanning.ts waitKindOf). */
const WAIT_KEY = {
  lease: 'pages.tasks.wait.lease',
  queue: 'pages.tasks.wait.queue',
  deps: 'pages.tasks.wait.deps',
  files: 'pages.tasks.wait.files',
  capacity: 'pages.tasks.wait.capacity'
} as const satisfies Record<WaitKind, string>
const WAIT_TONE: Record<WaitKind, ChipTone> = { lease: 'warn', queue: 'info', deps: 'neutral', files: 'neutral', capacity: 'neutral' }

/** usePlanLive's door while no project is open: never polled (enabled is false). */
const NO_DOOR = { command: async () => ({ status: 503, body: null }) } as unknown as Parameters<typeof usePlanLive>[0]
