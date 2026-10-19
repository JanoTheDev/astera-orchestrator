// The Overview section of the plan page (moved out of pages/PlanPage.tsx): progress and wave, usage, what the consoles
// did so far, talking to the planner, and approve/start and merge.
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { jobName } from '../../lib/jobName'
import { PlanSummaryRollup } from '../wall/PlanSummaryRollup' // W9-I
import { UsageStrip } from '../usage/UsageStrip'
import { Play } from 'lucide-react'
import { Button, Chip } from '../ui'
import { PlanMergeActions } from './PlanChanges'
import { PlanOverview } from './PlanOverview'
import { PlanTalk } from './PlanTalk'
import { approveSlot } from './planTalk'
import { RUN_START } from './planPage'
import { WaveLine } from './PlanWaves'
import type { PlanPageState } from './usePlanPage'

export function PlanOverviewSection({
  p,
  run,
  door,
  canOpenSession,
  onOpenSession
}: {
  p: PlanPageState
  run: JobRow | undefined
  door: OrchDoor
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { tasks, accounts, summaries, lockedReason, busy } = p
  const workers = summaries.summaries.some((s) => s.facts.role === 'worker')
  return (
    <>
      {/* W2-C plan board: progress and the buckets */}
      <div className="plan-head">
        <PlanOverview tasks={tasks} pick={run?.pick} decisions={run?.decisions} />
      </div>
      <WaveLine status={p.waveStatus} />
      {/* W6-G: per-account usage, live subagents per tab, and the threshold */}
      <UsageStrip accounts={accounts} tasks={tasks} />
      {/* W9-C: what each console did, rolled up (DESIGN.md §4) — W9-I's worker cards, or the empty hint */}
      {workers ? (
        <PlanSummaryRollup summaries={summaries.summaries} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />
      ) : (
        <section className="plan-sofar">
          <h3>{t('pages.plan.soFar')}</h3>
          <p className="modal-hint">{t('pages.plan.soFarEmpty')}</p>
        </section>
      )}
      {/* W7-A: talk to the planner, reject, and the auto-start notice */}
      {run && <PlanTalk row={run} door={door} name={jobName(run)} ui={p.ui} />}
      {!p.authoringOpen && (
        <div className="detail-graph-head">
          {/* Task 를 다 짜고 누르는 버튼. **Task 가 없으면 잠근다** — 빈 Run 을 시작하면
              pendingStart 만 걷히고 아무 일도 일어나지 않아, 눌렀는데 아무 반응이 없는
              자리가 된다. 누르면 게이트가 걷히고 이 버튼도 사라진다(run.pendingStart 가
              조건이다). */}
          {/* #116: a planned Job's planner not done yet, or an auto-approve plan: words, no button */}
          {run && (approveSlot(run) === 'planning' || approveSlot(run) === 'auto') && (
            <Chip tone="info">
              {approveSlot(run) === 'auto' ? t('jobs.run.startsByItself') : t('jobs.run.planning')}
            </Chip>
          )}
          {run && approveSlot(run) === 'approve' && (
            // 도는 동안은 회전과 문구로 바뀐다. **이 버튼에만 둔다** — 여기서 기다리는
            // 것은 워크트리 체크아웃이라 초 단위이고(authoringOpen 의 주석), 병합은
            // 묻는 모달을 한 번 지나므로 누른 직후가 빈 화면이 아니다.
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={14} />}
              loading={busy === RUN_START}
              disabled={lockedReason !== undefined || busy === RUN_START || tasks.length === 0}
              title={lockedReason ?? t('jobs.run.startHint')}
              onClick={() => void p.startRunNow()}
            >
              {busy === RUN_START ? t('jobs.run.starting') : t('jobs.run.start')}
            </Button>
          )}
          {/* **예약에서는 아이콘 토글 하나가 그 자리를 대신한다.** 시작과 재생이 같은 동작이라
              (둘 다 pendingStart 를 걷는다) 한 번도 돌리지 않은 템플릿에도 ▶ 가 맞다. 둘을
              따로 두면 "시작" 과 "재생" 이 다른 일처럼 보이고, 실제로는 같은 명령이다. */}
          <PlanMergeActions p={p} run={run} />
        </div>
      )}
    </>
  )
}
