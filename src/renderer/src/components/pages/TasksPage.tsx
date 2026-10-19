// W9-C Tasks page (DESIGN-W11 §9 "Tasks"): every Task of the project across plans, the Planning section first, then
// five columns, with a plan scope in the header. A waiting card names why with a chip (tasksPlanning waitKindOf). A card's column, its live line and where a click goes are planBoard.ts's (taskColumnOf, nowOf, reasonText,
// taskClickOf); the "why it waits" is core's taskBoardsOf, carried on JobTask.board.
import { useEffect, useMemo, useState } from 'react'
import type { JobRow, JobTask } from '../../../../core/types'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import type { AppState } from '../../state/appState'
import { localDoor } from '../../lib/orchDoor'
import { jobName } from '../../lib/jobName'
import { openConsole, openInbox, openPlan } from '../shell/navigation'
import { Button, Card, Chip, EmptyState, Icon, PageHeader, Tabs } from '../ui'
import { CircleCheck, FileStack, Gauge, Layers, ListOrdered, ListTodo, Lock, PenLine, Plus, SquareTerminal, Users, type LucideIcon } from 'lucide-react'
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
import { planningEntriesOf, stageText, waitKindOf, waitText, type WaitKind } from './tasksPlanning'
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

  const openCount = TASK_COLUMNS.filter((c) => c !== 'done').reduce((n, c) => n + (columns.get(c)?.length ?? 0), 0)
  const empty = planning.length === 0 && TASK_COLUMNS.every((c) => (columns.get(c)?.length ?? 0) === 0)
  const newTask =
    currentProject !== null ? (
      <Button variant="primary" icon={<Plus size={16} />} onClick={() => openStart({})}>
        {t('pages.tasks.new')}
      </Button>
    ) : undefined
  // The plan filter is a scope choice: one segmented control (DESIGN-W11 §7), its count the plan's done/total
  const scope = [
    { id: ALL, label: t('pages.tasks.allPlans') },
    ...plans.map((r) => ({
      id: r.id,
      label: (
        <>
          <span className="tasks-scope-name">{jobName(r)}</span>
          {!planningIds.has(r.id) && <span className="tasks-col-count">{`${r.done}/${r.total}`}</span>}
        </>
      )
    }))
  ]

  return (
    <div className="plan-pages tasks-page">
      <PageHeader
        title={t('pages.tasks.title')}
        subtitle={openCount > 0 ? t('pages.tasks.subtitle', { count: openCount }) : undefined}
        actions={newTask}
        filters={
          plans.length > 1 ? (
            <Tabs variant="segmented" label={t('pages.tasks.allPlans')} value={planFilter ?? ALL} onChange={(id) => setPlanFilter(id === ALL ? null : id)} items={scope} />
          ) : undefined
        }
      />
      {empty ? (
        <EmptyState icon={ListTodo} title={t('pages.tasks.emptyTitle')} action={newTask}>
          {t('pages.tasks.emptyBody')}
        </EmptyState>
      ) : (
        <div className="tasks-body">
          {planning.length > 0 && (
            <section className="tasks-planning" aria-label={t('pages.tasks.planning.title')}>
              <h2 className="tasks-col-head">
                {t('pages.tasks.planning.title')}
                <span className="tasks-col-count">{planning.length}</span>
              </h2>
              <div className="tasks-planning-list">
                {planning.map((e) => {
                  const stage = stageText(e)
                  return (
                    <Card key={e.plan.id} className="tasks-card tasks-planning-row" onClick={() => openPlan(e.plan.id)}>
                      <span className="tasks-card-head">
                        <Icon icon={e.stage === 'queued' ? ListOrdered : e.stage === 'ready' ? CircleCheck : PenLine} size={14} />
                        <span className="tasks-card-title" title={jobName(e.plan)}>
                          {jobName(e.plan)}
                        </span>
                      </span>
                      <span className="tasks-card-line">{t(stage.key, stage.params)}</span>
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
                      const tone = c !== 'needs-you' ? 'plain' : p.task.status === 'failed' ? 'danger' : 'need'
                      const reason = c === 'planned' ? p.task.board?.reason : undefined
                      const kind = waitKindOf(reason)
                      const wait = reason && kind ? waitText(reason, p.plan) : null
                      const waitWords = wait ? t(wait.key, wait.params) : null
                      return (
                        <Card key={`${p.plan.id}:${p.task.id}`} tone={tone} className="tasks-card" onClick={() => go(p)}>
                          <span className="tasks-card-head">
                            <TaskGlyph task={p.task} />
                            <span className="tasks-card-title" title={p.task.title}>
                              {p.task.title}
                            </span>
                          </span>
                          {waitWords && kind && (
                            <Chip tone={kind === 'limit' ? 'warn' : 'neutral'} className="tasks-wait">
                              <Icon icon={WAIT_ICON[kind]} size={14} />
                              {waitWords}
                            </Chip>
                          )}
                          {line && line !== waitWords && (
                            <span className="tasks-card-line" title={line}>
                              {line}
                            </span>
                          )}
                          <span className="tasks-card-meta">
                            {planFilter === null && <span className="tasks-card-plan">{jobName(p.plan)}</span>}
                            {p.task.provider && <span>{p.task.provider}</span>}
                            {p.task.model && <span>{p.task.model}</span>}
                            <span className="tasks-card-id">{p.task.id.slice(-6)}</span>
                          </span>
                        </Card>
                      )
                    })}
                  </div>
                  {c === 'done' && olderDone > 0 && <p className="tasks-col-more">{t('pages.tasks.olderDone', { count: olderDone })}</p>}
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** The Tabs id of "All plans" (no plan id starts with a dot). */
const ALL = '.all'

const WAIT_ICON: Record<WaitKind, LucideIcon> = {
  lease: Lock,
  queued: ListOrdered,
  wave: Layers,
  files: FileStack,
  limit: Gauge,
  cap: Users
}

/** usePlanLive's door while no project is open: never polled (enabled is false). */
const NO_DOOR = { command: async () => ({ status: 503, body: null }) } as unknown as Parameters<typeof usePlanLive>[0]
