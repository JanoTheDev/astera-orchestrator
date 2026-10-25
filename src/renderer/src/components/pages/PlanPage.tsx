// W9-C plan page: a plan's own page (RunDetail's window became it). T8 (DESIGN-W13 §5 `view:plan:<jobId>`): one
// scrollable document under the header. T3: a wide tab sets it in two columns, Needs you, the Steps and Plan settings on
// the left and a rail of the summary card, the Goal and the Activity on the right; a narrower one stacks them, the
// summary first (planPage.css). The shared state is plan/usePlanPage.ts; each part is its own file under components/plan/.
import type { JobRow, OrchSnapshot, RunDetail as RunDetailData } from '../../../../core/types'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { needsYouOf, type PlanSection } from '../plan/planBoard'
import { planAnchorId, planAnchorOf, taskAnchorId } from '../plan/planPage'
import { planTalkView } from '../plan/planTalk'
import { PlanChanges } from '../plan/PlanChanges'
import { PlanFiles } from '../plan/PlanFiles'
import { PlanHeader } from '../plan/PlanHeader'
import { PlanJournal } from '../plan/PlanJournal'
import { PlanGoal, PlanSoFar, PlanSummaryCard } from '../plan/PlanOverviewSection'
import { PlanSettings } from '../plan/PlanSettings'
import { PlanTalk } from '../plan/PlanTalk'
import { answerVia, PlanWaves } from '../plan/PlanWaves'
import { NeedsYou } from '../plan/TaskBoard'
import { jobName } from '../../lib/jobName'
import { Tabs } from '../ui'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import { usePlanPage } from '../plan/usePlanPage'
import '../plan/planPage.css'

type ActivityTab = 'log' | 'changes' | 'files' | 'talk' | 'sofar'
/** How long an anchored Task row stays marked (DESIGN-W13 §10). */
const FLASH_MS = 600

/** One section of the document: a title over its content; the anchors scroll to its id. */
function DocSection({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <section id={id} className="plan-doc-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="plan-doc-title">
        {title}
        {count !== undefined && <span className="plan-doc-count">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

export function PlanPage({
  run,
  detail,
  projectPath,
  runId,
  canOpenSession,
  onOpenSession,
  onShowOlderJournal,
  runtimeId,
  door,
  onOpenPath,
  section,
  seq = 0,
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
  /** The tab closes itself (shell/viewTabs); kept for PlansPage, which passes it. */
  onClose: () => void
  /** A paired Runtime's Run (remote runtime design Phase 6): its completion is read from that Runtime. Absent for this
   *  computer's own. Its actions go through `door`, which says when they are off. */
  runtimeId?: string
  /** Where this Run's commands, accounts and run configurations go: this computer or its Runtime (Phase 7). */
  door: OrchDoor
  /** W6-E: show an affected path (relative to the project) in the file explorer. */
  onOpenPath?: (path: string) => void
  /** T8: where the tab scrolls on opening (`openPlan(jobId, section)`): a section, `settings` or `task-<id>`. */
  section: PlanSection
  /** Counts the opens (planPage.ts nextPlanOpen): the same section opened again scrolls again. */
  seq?: number
  /** The page no longer has section tabs; kept for PlansPage, which passes it. */
  onSection: (section: PlanSection) => void
  /** The project's other plans: the ⋯ menu's "Start after". */
  plans: readonly JobRow[]
  /** The snapshot the plan is in: archive and delete count what goes with it (lib/jobActions). */
  snapshot: OrchSnapshot | null
  /** "Open consoles": the plan's consoles. */
  onOpenConsoles: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const p = usePlanPage({ run, detail, runId, door })
  // T19: simple by default; Advanced mode brings back the graph, the technical detail of a Task and "So far"
  const [advanced] = useAdvancedMode()
  const simple = !advanced
  const [tab, setTab] = useState<ActivityTab>(section === 'changes' || section === 'files' ? section : 'log')
  // A question form opened from the graph (PlanGraph's Ask/Answer) is drawn in the log
  const shownTab: ActivityTab = p.asking !== null || p.answering !== null ? 'log' : tab
  const needsYou = needsYouOf(p.tasks, p.live.questions)

  // T8 anchors: scroll to `#task-<id>` (expanding it) or `#settings` once per opening, when the target is drawn
  const anchor = planAnchorOf(section)
  const ready = anchor !== null && (anchor.kind !== 'task' || p.tasks.some((tk) => tk.id === anchor.taskId))
  const applied = useRef<string | null>(null)
  useEffect(() => {
    // the top again (a plan opened without a section): the next Task or settings anchor scrolls, even the same one
    if (anchor === null) applied.current = null
    const key = `${runId}:${section}:${seq}`
    if (anchor === null || !ready || applied.current === key) return
    applied.current = key
    if (anchor.kind === 'task') p.setSelected(anchor.taskId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(planAnchorId(anchor))
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      if (anchor.kind !== 'task') return
      el.classList.add('plan-flash')
      timer = setTimeout(() => el.classList.remove('plan-flash'), FLASH_MS)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per plan, anchor and open, when its target is drawn
  }, [runId, section, seq, ready])

  /** Needs you's Task name: expand its row and bring it into view. */
  const showTask = (taskId: string): void => {
    p.setSelected(taskId)
    requestAnimationFrame(() => document.getElementById(taskAnchorId(taskId))?.scrollIntoView({ block: 'center' }))
  }
  const tabs: { id: ActivityTab; label: string }[] = [
    { id: 'log', label: t('plan.doc.tab.log') },
    { id: 'changes', label: t('plan.doc.tab.changes') },
    { id: 'files', label: t('plan.doc.tab.files') },
    ...(run && planTalkView(run).show ? [{ id: 'talk' as const, label: t('plan.doc.tab.talk') }] : []),
    ...(advanced ? [{ id: 'sofar' as const, label: t('plan.doc.tab.sofar') }] : [])
  ]
  return (
    <div className="plan-page plan-doc">
      <PlanHeader
        p={p}
        run={run}
        runId={runId}
        runtimeId={runtimeId}
        door={door}
        plans={plans}
        snapshot={snapshot}
        onOpenConsoles={onOpenConsoles}
        simple={simple}
      />
      {run === undefined && <p className="jobs-disabled-reason">{t('pages.plan.gone')}</p>}
      {p.lockedReason !== undefined && <p className="jobs-disabled-reason">{p.lockedReason}</p>}
      <div className="plan-doc-body">
        <div className="plan-doc-main">
          {needsYou.length > 0 && (
            <DocSection id="plan-needs" title={t('plan.doc.needsYou')} count={needsYou.length}>
              <NeedsYou items={needsYou} onAnswer={answerVia(door, t as (k: string) => string)} onShowTask={showTask} />
            </DocSection>
          )}
          <DocSection id="plan-steps" title={t('plan.doc.steps')}>
            <PlanWaves
              p={p}
              door={door}
              runId={runId}
              runtimeId={runtimeId}
              projectPath={projectPath}
              detail={detail}
              canOpenSession={canOpenSession}
              onOpenSession={onOpenSession}
              simple={simple}
            />
          </DocSection>
          {/* T8: shown in simple mode too (DESIGN-W13 §13) */}
          <DocSection id="plan-settings" title={t('plan.doc.settings')}>
            <PlanSettings door={door} jobId={runId} row={run} confirm={p.ui.confirm} />
          </DocSection>
        </div>
        <div className="plan-doc-rail">
          {run && <PlanSummaryCard run={run} door={door} />}
          {run && (
            <DocSection id="plan-goal" title={t('plan.doc.goal')}>
              <PlanGoal run={run} />
            </DocSection>
          )}
          <DocSection id="plan-activity" title={t('plan.doc.activity')}>
            <Tabs variant="underline" label={t('plan.doc.tabs')} value={tabs.some((x) => x.id === shownTab) ? shownTab : 'log'} onChange={setTab} items={tabs} />
            <div className="plan-activity-body">
              {shownTab === 'log' && <PlanJournal p={p} detail={detail} canOpenSession={canOpenSession} onOpenSession={onOpenSession} onShowOlderJournal={onShowOlderJournal} />}
              {shownTab === 'changes' && <PlanChanges door={door} runId={runId} run={run} />}
              {shownTab === 'files' && <PlanFiles tasks={p.tasks} onOpenPath={onOpenPath} onSelect={p.onNodeClick} />}
              {shownTab === 'talk' && run && <PlanTalk row={run} door={door} name={jobName(run)} ui={p.ui} />}
              {shownTab === 'sofar' && <PlanSoFar p={p} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />}
            </div>
          </DocSection>
        </div>
      </div>
    </div>
  )
}
