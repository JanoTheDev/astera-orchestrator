// W9-C plan page: a plan's own page (RunDetail's window became it). A thin shell since W11: the header, the section
// switch and the shared state (plan/usePlanPage.ts); each section is its own file under components/plan/.
import type { JobRow, OrchSnapshot, RunDetail as RunDetailData } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import type { PlanSection } from '../plan/planBoard'
import { PlanChanges } from '../plan/PlanChanges'
import { PlanFiles } from '../plan/PlanFiles'
import { PlanHeader } from '../plan/PlanHeader'
import { PlanJournal } from '../plan/PlanJournal'
import { PlanOverviewSection } from '../plan/PlanOverviewSection'
import { PlanWaves } from '../plan/PlanWaves'
import { usePlanPage } from '../plan/usePlanPage'

export function PlanPage({
  run,
  detail,
  projectPath,
  runId,
  canOpenSession,
  onOpenSession,
  onShowOlderJournal,
  onClose,
  runtimeId,
  door,
  onOpenPath,
  section,
  onSection,
  plans,
  snapshot,
  onOpenConsoles
}: {
  /** 스냅샷에 있는 그 Run. 노드의 제목·상태·세션은 전부 여기서 온다(detail 은 id 만 준다).
   *  스냅샷과 detail 은 서로 다른 호출이라 어긋날 수 있으므로, 한쪽에만 있는 Task 는 그리지 않는다. */
  run: JobRow | undefined
  /** null 은 아직 도착하지 않았다는 뜻 — 빈 상태와 구분한다(JobsView 의 snapshot === null 과 같다) */
  detail: RunDetailData | null
  /** Task 짓기(task-create)와 그 검증 구성 조회(run.list)가 쓴다. App.tsx 의 openRun 이 이미 이
   *  짝을 들고 있으므로 그대로 받는다 — run?.id 로 대신하면 run 이 undefined 인 순간(스냅샷이 아직
   *  없거나 Run 이 막 사라졌을 때)에는 Task 를 지을 수 없어야 할 이유가 없는데도 지을 수 없게 된다. */
  projectPath: string
  runId: string
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  /** "이전 저널 기록 더 보기" — 저널 줄을 한 쪽 더 읽게 한다(stage 3 T1). 쪽 수는 App.tsx 가 든다 */
  onShowOlderJournal: () => void
  onClose: () => void
  /** A paired Runtime's Run (remote runtime design Phase 6): its completion is read from that Runtime. Absent for this
   *  computer's own. Its actions go through `door`, which says when they are off. */
  runtimeId?: string
  /** Where this Run's commands, accounts and run configurations go: this computer or its Runtime (Phase 7). */
  door: OrchDoor
  /** W6-E: show an affected path (relative to the project) in the file explorer. */
  onOpenPath?: (path: string) => void
  // W9-C plan page
  /** The segmented section shown (`openPlan(jobId, section?)`, else the one last used for this plan). */
  section: PlanSection
  onSection: (section: PlanSection) => void
  /** The project's other plans: the ⋯ menu's "Start after". */
  plans: readonly JobRow[]
  /** The snapshot the plan is in: archive and delete count what goes with it (lib/jobActions). */
  snapshot: OrchSnapshot | null
  /** "Its consoles": Agents, scoped to this plan. */
  onOpenConsoles: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const p = usePlanPage({ run, detail, runId, door, section })
  return (
    <div className="plan-page run-detail">
      <PlanHeader
        p={p}
        run={run}
        runId={runId}
        runtimeId={runtimeId}
        door={door}
        section={section}
        onSection={onSection}
        plans={plans}
        snapshot={snapshot}
        onClose={onClose}
        onOpenConsoles={onOpenConsoles}
      />
      {run === undefined && <p className="jobs-disabled-reason">{t('pages.plan.gone')}</p>}
      {p.lockedReason !== undefined && <p className="jobs-disabled-reason">{p.lockedReason}</p>}
      {/* flex: 1; min-height: 0 이 styles.css 에 있다 — 없으면 아래의 두 칸이 줄지 않아 모달 밖으로
          넘치고 닫기 버튼이 밀려난다. 이 저장소가 실제로 그 결함을 냈던 자리다 */}
      <div className="detail-body" data-section={section}>
        <div className="detail-graph">
          {section === 'overview' && (
            <PlanOverviewSection p={p} run={run} door={door} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />
          )}
          {section === 'waves' && (
            <PlanWaves
              p={p}
              door={door}
              runId={runId}
              projectPath={projectPath}
              detail={detail}
              canOpenSession={canOpenSession}
              onOpenSession={onOpenSession}
            />
          )}
          {section === 'changes' && <PlanChanges p={p} run={run} door={door} runId={runId} />}
          {section === 'files' && <PlanFiles tasks={p.tasks} onOpenPath={onOpenPath} onSelect={p.onNodeClick} />}
        </div>
        {p.eventsShown && (
          <PlanJournal
            p={p}
            door={door}
            runId={runId}
            projectPath={projectPath}
            runtimeId={runtimeId}
            detail={detail}
            canOpenSession={canOpenSession}
            onOpenSession={onOpenSession}
            onShowOlderJournal={onShowOlderJournal}
          />
        )}
      </div>
    </div>
  )
}
