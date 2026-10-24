// The Steps section of the plan page (moved out of pages/PlanPage.tsx): "Step n of m" and what opens the next one,
// the board/graph switch, adding a Task, and the board (by wave) or the dependency graph. W12: a wave is shown as a "step".
// T8: the board is a vertical list of steps; an expanded Task row shows its completion checks and changes.
import { useCallback, useRef, useState } from 'react'
import type { JobEvent, JobTask, RunDetail as RunDetailData } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import { checkChoicesOf } from '../checkText'
import { NewTaskModal } from '../NewTaskModal'
import { ChangedFilesBlock } from '../ChangedFilesBlock'
import { CompletionBlock } from '../CompletionBlock'
import { Button, Icon, Tabs } from '../ui'
import { coordinatorRefreshOf, replanningOf } from './planBoard'
import { taskAnchorId, type WaveStatus } from './planPage'
import { Graph } from './PlanGraph'
import { TaskBoard } from './TaskBoard'
import { TaskDetail } from './TaskDetail'
import type { PlanPageState } from './usePlanPage'
import './planPage.css'

/** "Step 2 of 4 · Step 3 starts when 2 tasks finish". Nothing while the plan has no Tasks. */
/** `brief`: only "Step n of m" (the page header, where the title needs the room). */
export function WaveLine({ status, brief = false }: { status: WaveStatus | null; brief?: boolean }): React.JSX.Element | null {
  const { t } = useI18n()
  if (status === null) return null
  const next = status.next
  const nextText =
    next === null
      ? null
      : next.kind === 'replan'
        ? t('plan.steps.replanning', { n: next.n })
        : next.kind === 'opens'
          ? t(next.left === 1 ? 'plan.steps.opens.one' : 'plan.steps.opens', { n: next.n, count: next.left })
          : next.kind === 'last'
            ? t(next.left === 1 ? 'plan.steps.last.one' : 'plan.steps.last', { count: next.left })
            : t('plan.steps.allDone')
  return (
    <span className="plan-page-wave">
      <Icon name="layers" size={14} />
      <span className="plan-page-wave-at">{t('plan.steps.of', { at: status.at, of: status.of })}</span>
      {!brief && nextText !== null && <span className="plan-page-wave-next">{nextText}</span>}
    </span>
  )
}

/** What `questions-answer` answered: null when it went through, else why not. The board's Needs you and the Inbox send it. */
export const answerVia =
  (door: OrchDoor, t: (k: string) => string) =>
  async (id: string, answer: string): Promise<string | null> => {
    const r = await door.command('questions-answer', { id, answer })
    return r.status === 200 ? null : replyNote(r, t as never, (r.body as { error?: string } | null)?.error ?? t('plan.question.failed'))
  }

// fallbacks with one identity, so an absent detail or timeline does not hand TaskBoard a new array every render
const NO_LAYERS: string[][] = []
const NO_EVENTS: JobEvent[] = []

/** The Task board of a plan with its sessions wired in, and an expanded row's completion checks and changes.
 *  `compact`: no model, account, branch or files in a row's detail (simple mode). */
export function PlanTaskBoard({
  p,
  door,
  runId,
  runtimeId,
  projectPath,
  detail,
  canOpenSession,
  onOpenSession,
  compact = false,
  onAddTask
}: {
  p: PlanPageState
  door: OrchDoor
  runId: string
  runtimeId?: string
  projectPath: string
  detail: RunDetailData | null
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  compact?: boolean
  onAddTask?: (deps: string[]) => void
}): React.JSX.Element {
  const { tasks, accounts, selectedTask, onNodeClick, events, live, summaries } = p
  // p is a new object every render; the callbacks below read it through a ref so TaskBoard's memo can hold
  const pRef = useRef(p)
  pRef.current = p
  const onRestart = useCallback((id: string) => void pRef.current.restartTask(id), [])
  const openRef = useRef({ canOpenSession, onOpenSession })
  openRef.current = { canOpenSession, onOpenSession }
  const onSelect = useCallback((id: string) => pRef.current.onNodeClick(id), [])
  const canOpen = useCallback((id: string) => openRef.current.canOpenSession(id), [])
  const openSession = useCallback((id: string) => openRef.current.onOpenSession(id), [])
  const renderAbout = useCallback(
    (tk: JobTask) => (
      // T2: everything about the Task, its Edit and its Request changes; a dep's title opens that Task's row
      <TaskDetail
        door={door}
        jobId={runId}
        task={tk}
        tasks={tasks}
        ui={pRef.current.ui}
        compact={compact}
        accountLabel={(id) => accounts?.find((a) => a.id === id)?.label ?? id}
        onRestart={onRestart}
        onShowTask={(id) => {
          pRef.current.setSelected(id)
          requestAnimationFrame(() => document.getElementById(taskAnchorId(id))?.scrollIntoView({ block: 'center' }))
        }}
      />
    ),
    [door, runId, tasks, compact, accounts, onRestart]
  )
  const renderDetail = useCallback(
    (tk: JobTask) => (
      <>
        {/* 고른 Task 의 완료 상세 — 왜 못 넘었는가(설계 §2) — and what it changed (Phase 10) */}
        <CompletionBlock projectPath={projectPath} runId={runId} taskId={tk.id} runtimeId={runtimeId} />
        <ChangedFilesBlock door={door} runId={runId} taskId={tk.id} />
      </>
    ),
    [projectPath, runId, runtimeId, door]
  )
  return (
    <TaskBoard
      tasks={tasks}
      accounts={accounts}
      selected={selectedTask?.id}
      onSelect={onSelect}
      layers={detail?.layers ?? NO_LAYERS}
      deps={detail?.deps}
      events={events ?? NO_EVENTS}
      activity={live.activity}
      sessions={live.sessions}
      replanning={replanningOf(live.activity, runId)}
      refreshed={coordinatorRefreshOf(live.activity, runId)}
      canOpenSession={canOpen}
      onOpenSession={openSession}
      projectPath={projectPath}
      summaries={summaries.byTask}
      nowMs={live.nowMs}
      compact={compact}
      onAddTask={onAddTask}
      onRestart={onRestart}
      lockedReason={p.lockedReason}
      renderAbout={renderAbout}
      renderDetail={renderDetail}
    />
  )
}

export function PlanWaves({
  p,
  door,
  runId,
  runtimeId,
  projectPath,
  detail,
  canOpenSession,
  onOpenSession,
  simple = false
}: {
  p: PlanPageState
  door: OrchDoor
  runId: string
  runtimeId?: string
  projectPath: string
  detail: RunDetailData | null
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  /** T19: simple mode: the board only (no graph), its rows without the technical detail */
  simple?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const { tasks, accounts, selectedTask, onNodeClick, view, setView, waveStatus, lockedReason, busy } = p
  const graph = !simple && view === 'graph'
  // "Add task to this step" presets the form's deps; the bar's button opens it empty
  const [initialDeps, setInitialDeps] = useState<string[]>([])
  const canAdd = lockedReason === undefined && busy === null && !p.authoringOpen
  const pRef = useRef(p)
  pRef.current = p
  const addTask = useCallback((deps: string[]) => {
    setInitialDeps(deps)
    pRef.current.setAuthoring(true)
  }, [])
  return (
    <>
      <div className="plan-steps-bar">
        <WaveLine status={waveStatus} brief />
        {!simple && (
          <Tabs
            variant="segmented"
            label={t('plan.steps.viewLabel')}
            value={view}
            onChange={setView}
            items={(['board', 'graph'] as const).map((v) => ({ id: v, label: t(`plan.view.${v}`) }))}
          />
        )}
        {/* 명령이 도는 동안에는 잠근다 — 그 동안 Task 를 짓기 시작하면 도는 명령의 결과를 아무도 보지 못한다
            (실행·병합이 busy 를 잠그는 것과 같은 이유). The form is a Modal over the page (T8). */}
        <Button
          size="sm"
          icon={<Icon name="add" size={14} />}
          disabled={lockedReason !== undefined || busy !== null || p.authoringOpen}
          title={lockedReason}
          onClick={() => {
            setInitialDeps([])
            p.setAuthoring(true)
          }}
        >
          {t('jobs.task.new')}
        </Button>
      </div>
      {p.authoring && (
        // **계정을 provider 로 걸러 보내지 않는다** — 이 폼에서 고른 첫 계정이 provider 를 정하므로(Task.accountIds),
        // 걸러 보낼 기준이 이 시점에 없다. 두 번째 칸부터 첫 계정의 provider 로 좁히는 일은 폼 안에서 한다.
        <NewTaskModal
          door={door}
          runId={runId}
          tasks={p.tasks}
          accounts={p.accounts}
          initialDeps={initialDeps}
          runConfigs={p.runConfigs === null ? null : checkChoicesOf(p.runConfigs, p.checkPlugins, t)}
          onClose={() => p.setAuthoring(false)}
          onCreated={() => p.setAuthoring(false)}
        />
      )}
      {!graph ? (
        <PlanTaskBoard
          p={p}
          door={door}
          runId={runId}
          runtimeId={runtimeId}
          projectPath={projectPath}
          detail={detail}
          canOpenSession={canOpenSession}
          onOpenSession={onOpenSession}
          compact={simple}
          onAddTask={canAdd ? addTask : undefined}
        />
      ) : (
        <Graph
          tasks={tasks}
          layers={detail?.layers ?? NO_LAYERS}
          deps={detail?.deps ?? {}}
          cyclic={detail?.cyclic ?? []}
          selected={selectedTask?.id}
          onSelect={onNodeClick}
          canOpenSession={canOpenSession}
          onOpenSession={onOpenSession}
          canManualStart={p.canManualStart}
          formOpen={p.formOpen}
          lockedReason={lockedReason}
          accountLabel={(id) => accounts?.find((a) => a.id === id)?.label ?? id}
          onStart={(taskId) => void p.startTask(taskId)}
          onStop={(taskId) => void p.stopTask(taskId)}
          onGate={(taskId) => {
            p.setAsking(taskId)
            p.setQuestion('')
            p.setGateError(null)
          }}
          onAnswer={(taskId) => {
            p.setAnswering(taskId)
            p.setAnswer('')
            p.setGateError(null)
          }}
          onRestart={(taskId) => void p.restartTask(taskId)}
          onStopConvergence={(taskId) => void p.stopConvergence(taskId)}
        />
      )}
    </>
  )
}
