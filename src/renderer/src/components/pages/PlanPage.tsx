import { useState } from 'react'
import type { JobRow, OrchSnapshot, RunDetail as RunDetailData } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { ChangedFilesBlock } from '../ChangedFilesBlock'
import { jobName } from '../../lib/jobName'
// W9-C plan page; W11 split it into components/plan (PlanHeader, PlanWaves, PlanGraph, PlanTaskForm, PlanJournal, PlanChanges)
import { Button, Chip } from '../ui'
import { type PlanSection } from '../plan/planBoard'
import { PlanHeader } from '../plan/PlanHeader'
import { PlanWaves, type WavesView } from '../plan/PlanWaves'
import { PlanTaskForm } from '../plan/PlanTaskForm'
import { PlanJournal } from '../plan/PlanJournal'
import { PlanMerge } from '../plan/PlanChanges'
import { RUN_MERGE, RUN_START, usePlanActions } from '../plan/usePlanActions'
// W2-C plan board
import { PlanOverview } from '../plan/PlanOverview'
import { PlanSummaryRollup } from '../wall/PlanSummaryRollup' // W9-I
import { useSummaries } from '../../state/useSummaries'
import { PlanTalk } from '../plan/PlanTalk'
import { approveSlot } from '../plan/planTalk'
import { UsageStrip } from '../usage/UsageStrip'
// W6-E progress view
import { PlanFiles } from '../plan/PlanFiles'
import { usePlanLive } from '../plan/usePlanLive'
import '../plan/planPage.css'

/** 한 Run 의 상세 창 — 위가 의존 그래프, 아래가 이벤트다. **더 이상 읽기 전용이 아니다** — Task 8 이
 *  여기서 Task 를 짓게 했고(`task-create`), Task 9 가 노드에서 `띄우기`·`멈추기`·`물어보기`·
 *  `다시 띄우기`(`worker-start`·`worker-stop`·`gate-create`·`task-update`)를 열었다. 이 계획이
 *  초안될 때는 이 파일이 쓰는 쪽이 될 줄 몰랐고, 그 반전은 `knowledge/decisions/ADR-004`에 있다.
 *  **Gate 에 답하는 것도 이제 여기다**(`답하기` → `gate-resolve`). 한때 이 주석은 그것이 "아직
 *  Slack 제어면의 몫"이라고 적었는데, 그 절반이 참인 동안 앱은 Gate 를 **열고 보여 주기만 하고
 *  푸는 곳이 아무 데도 없었다** — 로드맵 5번이 그래서 "Slack 에 제어면을 만든다"에서 "Gate 를
 *  앱에서 푼다"로 좁아졌다. 사람이 앱에서 일을 만들게 해 놓고 그 일이 던지는 질문은 다른 데서
 *  답하라는 것은 앞뒤가 맞지 않고, `물어보기` 로 연 Gate 는 애초에 사람이 스스로 쓴 질문이다.
 *  Slack 은 알림으로 남는다.
 *
 *  **그래프는 장식이 아니라 필터다.** 노드를 누르면 아래가 그 Task 의 이벤트만 남는다 — "왜 저게
 *  안 도나"(위)와 "저기서 무슨 일이 있었나"(아래)가 한 화면에서 이어지고, 이벤트가 수십 줄이 되는
 *  문제도 같이 풀린다(가려진 개수는 맨 아래에 적는다).
 *
 *  두 칸을 옆이 아니라 위아래로 두는 이유는 자라는 방향이다: 그래프는 한 층에 Task 가 늘수록
 *  **가로로** 자라고, 이벤트는 세로로 자란다. 옆에 세우면 그래프가 창의 절반도 못 쓰고 넷만 나란히
 *  서도 잘린다. 스크롤은 둘 다 자기 칸 안에서만 돈다(styles.css 의 min-height: 0).
 *
 *  이 컴포넌트에는 테스트가 없다(렌더러에 jsdom 이 없다). 그래서 판정은 전부 core 에 있고 —
 *  이벤트는 orchestration/timeline.ts, 층은 graph.ts, 노드의 좌표는 graphLayout.ts — 여기는 건네받은
 *  것을 그리기만 한다. */
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
  /** Why the controls are off: a read-only pairing (Phase 7). They are drawn disabled with it as their title, and it
   *  is said under the head, so the reason is on screen rather than a button that does nothing. */
  const lockedReason = door.readOnlyReason ?? undefined
  const tasks = run?.tasks ?? []
  const actions = usePlanActions({ run, runId, door, tasks })
  const { ui, busy, authoringOpen, formOpen } = actions
  /** 고른 노드 = 아래 이벤트의 필터. 같은 노드를 다시 누르면 풀린다 */
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // W2-C plan board: the graph or the board in the upper half; the overview sits above either.
  // W6-E: the board (by wave) opens first, as the place a plan run is watched, and a files tab joins them
  // W9-C: the board and the graph are the Waves section; files is its own section
  const [view, setView] = useState<WavesView>('board')
  const live = usePlanLive(door, section === 'waves')
  const summaries = useSummaries(door, runId) // W9-I: the board's lines and "What happened so far"
  // 고른 Task 가 스냅샷에서 사라졌으면 필터도 없다 — 걸러 낸 목록이 영원히 비는 대신 전체를 그린다
  const selectedTask = tasks.find((tk) => tk.id === selected)

  /** 그래프 노드 클릭은 필터 하나만 뜻한다 — 같은 노드를 다시 누르면 풀린다.
   *
   *  **예전에는 뜻이 둘이었다**: 짓는 중이면 의존을 고르고, 아니면 필터였다. 의존이 폼의 셀렉트로
   *  가면서 그 분기가 없어졌고, 함께 없어진 것이 하나 더 있다 — 같은 노드가 "걸러 놓은 것"과
   *  "고른 의존" 두 표시를 동시에 달 수 있던 상태다(청록 링과 체크 글리프). 뜻이 하나면 표시도
   *  하나다.
   *
   *  **폼이 열려 있는 동안에는 클릭을 통째로 무시한다.** 노드 버튼들이 이 동안 전부 숨는 것
   *  (node() 의 `!formOpen &&`)과 같은 규칙이다 — 버튼만 숨기고 노드 자신의 onClick 을 그대로
   *  두면, 폼을 쓰는 중에 다른 노드를 눌러 필터 링을 조용히 옮길 수 있는 구멍이 남는다. 이 판단을
   *  Graph 안에 두지 않고 여기 두는 것은 Graph 는 그리기만 한다는 파일 머리말의 규칙이다. */
  const onNodeClick = (id: string): void => {
    if (formOpen) return
    setSelected((prev) => (prev === id ? null : id))
  }
  /** Shows the moved events pane: always on Journal; on Waves while a form is open or a Task is picked. */
  const eventsShown = section === 'journal' || (section === 'waves' && (authoringOpen || selectedTask !== undefined))
  const approve = run ? approveSlot(run) : null

  return (
    <div className="plan-page run-detail">
      <PlanHeader
        run={run}
        runId={runId}
        tasks={tasks}
        door={door}
        ui={ui}
        runtimeId={runtimeId}
        lockedReason={lockedReason}
        formOpen={formOpen}
        plans={plans}
        snapshot={snapshot}
        section={section}
        onSection={onSection}
        onClose={onClose}
        onOpenConsoles={onOpenConsoles}
      />
      {run === undefined && <p className="jobs-disabled-reason">{t('pages.plan.gone')}</p>}
      {/* flex: 1; min-height: 0 이 styles.css 에 있다 — 없으면 아래의 두 칸이 줄지 않아 모달 밖으로
          넘치고 닫기 버튼이 밀려난다. 이 저장소가 실제로 그 결함을 냈던 자리다 */}
      <div className="detail-body" data-section={section}>
        <div className="detail-graph">
          {/* W2-C plan board: progress and the buckets */}
          {section === 'overview' && (
            <div className="plan-head">
              <PlanOverview tasks={tasks} pick={run?.pick} decisions={run?.decisions} />
            </div>
          )}
          {/* W6-G: per-account usage, live subagents per tab, and the threshold */}
          {section === 'overview' && <UsageStrip accounts={actions.accounts} tasks={tasks} />}
          {/* W9-C: what each console did, rolled up (DESIGN.md §4) — W9-I's worker cards, or the empty hint */}
          {section === 'overview' && summaries.summaries.some((s) => s.facts.role === 'worker') && (
            <PlanSummaryRollup summaries={summaries.summaries} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />
          )}
          {section === 'overview' && !summaries.summaries.some((s) => s.facts.role === 'worker') && (
            <section className="plan-sofar">
              <h3>{t('pages.plan.soFar')}</h3>
              <p className="modal-hint">{t('pages.plan.soFarEmpty')}</p>
            </section>
          )}
          {/* W7-A: talk to the planner, reject, and the auto-start notice */}
          {section === 'overview' && run && <PlanTalk row={run} door={door} name={jobName(run)} ui={ui} />}
          {lockedReason !== undefined && <p className="jobs-disabled-reason">{lockedReason}</p>}
          {!authoringOpen && (section === 'overview' || section === 'changes') && (
            <div className="detail-graph-head">
              {/* Task 를 다 짜고 누르는 버튼. **Task 가 없으면 잠근다** — 빈 Run 을 시작하면
                  pendingStart 만 걷히고 아무 일도 일어나지 않아, 눌렀는데 아무 반응이 없는
                  자리가 된다. 누르면 게이트가 걷히고 이 버튼도 사라진다(run.pendingStart 가
                  조건이다). */}
              {/* #116: a planned Job's planner not done yet, or an auto-approve plan: words, no button */}
              {section === 'overview' && (approve === 'planning' || approve === 'auto') && (
                <Chip tone="info">{approve === 'auto' ? t('jobs.run.startsByItself') : t('jobs.run.planning')}</Chip>
              )}
              {section === 'overview' && approve === 'approve' && (
                // 도는 동안은 회전과 문구로 바뀐다. **이 버튼에만 둔다** — 여기서 기다리는
                // 것은 워크트리 체크아웃이라 초 단위이고(authoringOpen 의 주석), 병합은
                // 묻는 모달을 한 번 지나므로 누른 직후가 빈 화면이 아니다.
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === RUN_START}
                  disabled={lockedReason !== undefined || tasks.length === 0}
                  title={lockedReason ?? t('jobs.run.startHint')}
                  onClick={() => void actions.startRunNow()}
                >
                  {busy === RUN_START ? t('jobs.run.starting') : t('jobs.run.start')}
                </Button>
              )}
              {/* **예약에서는 아이콘 토글 하나가 그 자리를 대신한다.** 시작과 재생이 같은 동작이라
                  (둘 다 pendingStart 를 걷는다) 한 번도 돌리지 않은 템플릿에도 ▶ 가 맞다. 둘을
                  따로 두면 "시작" 과 "재생" 이 다른 일처럼 보이고, 실제로는 같은 명령이다. */}
              <PlanMerge run={run} lockedReason={lockedReason} merging={busy === RUN_MERGE} onMerge={() => void actions.mergeRunNow()} />
            </div>
          )}
          {/* W9-C Changes: what the whole plan changed, from git where it runs (Phase 10) */}
          {section === 'changes' && <ChangedFilesBlock door={door} runId={runId} />}
          {section === 'files' && <PlanFiles tasks={tasks} onOpenPath={onOpenPath} onSelect={onNodeClick} />}
          {section === 'waves' && (
            <PlanWaves
              view={view}
              onView={setView}
              tasks={tasks}
              detail={detail}
              accounts={actions.accounts}
              live={live}
              summaries={summaries.byTask}
              actions={actions}
              door={door}
              runId={runId}
              projectPath={projectPath}
              lockedReason={lockedReason}
              selected={selectedTask?.id}
              onSelect={onNodeClick}
              canOpenSession={canOpenSession}
              onOpenSession={onOpenSession}
            />
          )}
        </div>
        {eventsShown && (
          <div className="detail-events">
            {authoringOpen ? (
              <PlanTaskForm actions={actions} door={door} runId={runId} tasks={tasks} />
            ) : (
              <PlanJournal
                detail={detail}
                selectedTask={selectedTask}
                accounts={actions.accounts}
                onClearFilter={() => setSelected(null)}
                projectPath={projectPath}
                runId={runId}
                runtimeId={runtimeId}
                door={door}
                canOpenSession={canOpenSession}
                onOpenSession={onOpenSession}
                onShowOlderJournal={onShowOlderJournal}
                open={open}
                onToggle={toggle}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
