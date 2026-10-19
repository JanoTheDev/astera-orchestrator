// The Waves section: where the plan stands ("Wave 2 of 3 · Wave 3 opens when A, B finish"), the + Task button, the
// Board / Graph switch, and the board or graph itself. The waves are planBoard.ts's; the gate line is planWaves.ts's.
import type { Account, JobTask, RunDetail as RunDetailData } from '../../../../core/types'
import type { SessionSummary } from '../../../../core/sessions/summary'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import { Plus } from 'lucide-react'
import { Button, Tabs } from '../ui'
import { TaskBoard } from './TaskBoard'
import { PlanGraph } from './PlanGraph'
import { coordinatorRefreshOf, replanningOf, wavesOf } from './planBoard'
import { titlesLine, waveStatusOf } from './planWaves'
import type { usePlanLive } from './usePlanLive'
import type { PlanActions } from './usePlanActions'
import './planPage.css'

export type WavesView = 'graph' | 'board'

export function PlanWaves({
  view,
  onView,
  tasks,
  detail,
  accounts,
  live,
  summaries,
  actions: a,
  door,
  runId,
  projectPath,
  lockedReason,
  selected,
  onSelect,
  canOpenSession,
  onOpenSession
}: {
  view: WavesView
  onView: (view: WavesView) => void
  tasks: JobTask[]
  detail: RunDetailData | null
  accounts: Account[] | null
  live: ReturnType<typeof usePlanLive>
  summaries: ReadonlyMap<string, SessionSummary>
  actions: PlanActions
  door: OrchDoor
  runId: string
  projectPath: string
  lockedReason: string | undefined
  selected: string | undefined
  onSelect: (taskId: string) => void
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const layers = detail?.layers ?? []
  const status = waveStatusOf(wavesOf(tasks, layers), detail?.deps ?? {})
  return (
    <>
      <div className="plan-waves-bar">
        <p className="plan-waves-status" role="status">
          {status.kind === 'done' && <b>{t('plan.wave.allDone', { total: status.total })}</b>}
          {status.kind === 'running' && (
            <>
              <b>{t('plan.wave.ofTotal', { n: status.n, total: status.total })}</b>
              {status.waitingOn.length > 0 && (
                <span title={status.waitingOn.map((tk) => tk.title).join('\n')}>
                  {status.next === null
                    ? t('plan.wave.finishesWhen', { tasks: titlesLine(status.waitingOn) })
                    : t('plan.wave.opensWhen', { n: status.next, tasks: titlesLine(status.waitingOn) })}
                </span>
              )}
            </>
          )}
        </p>
        {/* 짓는 동안(또는 질문을 쓰는 동안)에는 치운다 — 질문을 쓰는 중에 누르면 아래 칸이
            통째로 NewTaskModal 로 바뀌어 아직 안 보낸 질문을 잃고, Task 를 짓는 중에 누르면
            폼이 다시 그려져 채워 둔 것을 잃는다. 이 버튼이 여는 것은 새 창이 아니라 아래 칸
            (.detail-events)의 두 번째 모습이다: 그래프는 그대로 보이고 아래만 바뀐다. */}
        {/* 명령이 도는 동안 이 줄은 남지만(authoringOpen 의 주석), 그 동안 Task 를 짓기
            시작하면 폼이 열리며 줄이 사라지고 도는 명령의 결과를 아무도 보지 못한다 —
            실행·병합이 busy 를 잠그는 것과 같은 이유다. */}
        {!a.authoringOpen && (
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={lockedReason !== undefined || a.busy !== null}
            title={lockedReason}
            onClick={() => a.setAuthoring(true)}
          >
            {t('jobs.task.new')}
          </Button>
        )}
        <Tabs
          variant="segmented"
          label={t('pages.plan.section.waves')}
          value={view}
          onChange={onView}
          items={(['board', 'graph'] as const).map((v) => ({ id: v, label: t(`plan.view.${v}`) }))}
        />
      </div>
      {view === 'board' ? (
        <TaskBoard
          tasks={tasks}
          accounts={accounts}
          selected={selected}
          onSelect={onSelect}
          layers={layers}
          events={detail?.events ?? []}
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
          summaries={summaries}
        />
      ) : (
        <PlanGraph
          tasks={tasks}
          layers={layers}
          deps={detail?.deps ?? {}}
          cyclic={detail?.cyclic ?? []}
          selected={selected}
          onSelect={onSelect}
          canOpenSession={canOpenSession}
          onOpenSession={onOpenSession}
          canManualStart={a.canManualStart}
          formOpen={a.formOpen}
          lockedReason={lockedReason}
          onStart={(taskId) => void a.startTask(taskId)}
          onStop={(taskId) => void a.stopTask(taskId)}
          onGate={a.openAsk}
          onAnswer={a.openAnswer}
          onRestart={(taskId) => void a.restartTask(taskId)}
          onStopConvergence={(taskId) => void a.stopConvergence(taskId)}
        />
      )}
    </>
  )
}
