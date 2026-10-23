// The Waves section of the plan page (moved out of pages/PlanPage.tsx): "Step n of m" and what opens the next one,
// the board/graph switch, adding a Task, and the board (by wave) or the dependency graph. W12: a wave is shown as a "step".
import type { RunDetail as RunDetailData } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import { checkChoicesOf } from '../checkText'
import { NewTaskModal } from '../NewTaskModal'
import { Button, Icon, Tabs } from '../ui'
import { coordinatorRefreshOf, replanningOf } from './planBoard'
import type { WaveStatus } from './planPage'
import { Graph } from './PlanGraph'
import { TaskBoard } from './TaskBoard'
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

/** The Task board of a plan with its answers and sessions wired in; the waves section and the simple plan view both draw it.
 *  `compact`: no model, account, branch or files on the cards (simple mode). */
export function PlanTaskBoard({
  p,
  door,
  runId,
  projectPath,
  detail,
  canOpenSession,
  onOpenSession,
  compact = false
}: {
  p: PlanPageState
  door: OrchDoor
  runId: string
  projectPath: string
  detail: RunDetailData | null
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  compact?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const { tasks, accounts, selectedTask, onNodeClick, events, live, summaries } = p
  return (
    <TaskBoard
      tasks={tasks}
      accounts={accounts}
      selected={selectedTask?.id}
      onSelect={onNodeClick}
      layers={detail?.layers ?? []}
      events={events ?? []}
      activity={live.activity}
      questions={live.questions}
      onAnswer={async (id, answer) => {
        const r = await door.command('questions-answer', { id, answer })
        return r.status === 200 ? null : replyNote(r, t as never, (r.body as { error?: string } | null)?.error ?? t('plan.question.failed'))
      }}
      sessions={live.sessions}
      replanning={replanningOf(live.activity, runId)}
      refreshed={coordinatorRefreshOf(live.activity, runId)}
      canOpenSession={canOpenSession}
      onOpenSession={onOpenSession}
      projectPath={projectPath}
      summaries={summaries.byTask}
      nowMs={live.nowMs}
      compact={compact}
    />
  )
}

export function PlanWaves({
  p,
  door,
  runId,
  projectPath,
  detail,
  canOpenSession,
  onOpenSession
}: {
  p: PlanPageState
  door: OrchDoor
  runId: string
  projectPath: string
  detail: RunDetailData | null
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { tasks, accounts, selectedTask, onNodeClick, events, live, summaries, view, setView, waveStatus, lockedReason, busy } = p
  return (
    <>
      <div className="plan-head plan-page-waves-head">
        <WaveLine status={waveStatus} />
        <Tabs
          variant="segmented"
          label={t('plan.steps.viewLabel')}
          value={view}
          onChange={setView}
          items={(['graph', 'board'] as const).map((v) => ({ id: v, label: t(`plan.view.${v}`) }))}
        />
      </div>
      {/* 짓는 동안(또는 질문을 쓰는 동안)에는 치운다 — 질문을 쓰는 중에 누르면 아래 칸이
          통째로 NewTaskModal 로 바뀌어 아직 안 보낸 질문을 잃고, Task 를 짓는 중에 누르면
          폼이 다시 그려져 채워 둔 것을 잃는다. 이 버튼이 여는 것은 새 창이 아니라 아래 칸
          (.detail-events)의 두 번째 모습이다: 그래프는 그대로 보이고 아래만 바뀐다. */}
      {p.authoring && (
        // **계정을 provider 로 걸러 보내지 않는다** — 이 폼에서 고른 첫 계정이 provider 를 정하므로(Task.accountIds),
        // 걸러 보낼 기준이 이 시점에 없다. 두 번째 칸부터 첫 계정의 provider 로 좁히는 일은 폼 안에서 한다.
        <NewTaskModal
          door={door}
          runId={runId}
          tasks={p.tasks}
          accounts={p.accounts}
          runConfigs={p.runConfigs === null ? null : checkChoicesOf(p.runConfigs, p.checkPlugins, t)}
          onClose={() => p.setAuthoring(false)}
          onCreated={() => p.setAuthoring(false)}
        />
      )}
      {!p.authoringOpen && (
        <div className="detail-graph-head">
          {/* 명령이 도는 동안 이 줄은 남지만(authoringOpen 의 주석), 그 동안 Task 를 짓기
              시작하면 폼이 열리며 줄이 사라지고 도는 명령의 결과를 아무도 보지 못한다 —
              실행·병합이 busy 를 잠그는 것과 같은 이유다. */}
          <Button
            size="sm"
            icon={<Icon name="add" size={14} />}
            disabled={lockedReason !== undefined || busy !== null}
            title={lockedReason}
            onClick={() => p.setAuthoring(true)}
          >
            {t('jobs.task.new')}
          </Button>
        </div>
      )}
      {view === 'board' ? (
        <PlanTaskBoard p={p} door={door} runId={runId} projectPath={projectPath} detail={detail} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />
      ) : (
        <Graph
          tasks={tasks}
          layers={detail?.layers ?? []}
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
