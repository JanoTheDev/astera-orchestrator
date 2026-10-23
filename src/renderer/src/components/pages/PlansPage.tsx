// W9-C Plans page (DESIGN.md §2 "Plans"): the project's plans "By area" (Job.areas) or as the "Overlap" table
// (plans × folders), and a plan's own page (PlanPage, which RunDetail's window became). W11: the list is native
// (plan/PlanList.tsx, its rows plan/PlanRow.tsx, the Coordinator strip plan/Coordinator.tsx); the order, the groups and
// the table are planBoard.ts's.
import { useEffect, useState } from 'react'
import type { JobRow } from '../../../../core/types'
import type { PageId } from '../../../../core/ui/pages'
import { findRun } from '../../../../core/orchestration/snapshot'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { parentDir, resolveRelative } from '../../../../core/files/paths'
import type { AppState } from '../../state/appState'
import { localDoor } from '../../lib/orchDoor'
import { archiveJob, deleteRun, holdJob, renameJob, resolveFailed, unarchiveJob } from '../../lib/jobActions'
import { jobName } from '../../lib/jobName'
import { jobsStall } from '../../../../core/orchestration/jobsView'
import { Button, EmptyState, ICONS } from '../ui'
import { openPage } from '../shell/navigation'
import { overlapTableOf, planSectionOf, type OverlapCell, type PlanSection } from '../plan/planBoard'
import { MainPlan } from '../plan/MainPlan'
import { PlanList } from '../plan/PlanList'
import type { PlanActs } from '../plan/PlanRow'
import { PlanPage } from './PlanPage'
import '../plan/plan.css'

/** Which of W9-C's pages shows: W9-B's page (state/useSidebar.ts `page`) when it is one of them. `section` is the
 *  plan section asked for by `openPlan(jobId, section)`; absent, the one last used for that plan. */
export type PlanPages = { page: 'tasks' | 'plans'; section?: PlanSection } | null

/** The page state over W9-B's page switch, and the plans page coming up whenever a plan is opened from anywhere
 *  (`openRun`). Setting null leaves for Agents (the consoles the plan page's tab links go to). */
export function usePlanPages({ openRun, page, goPage }: {
  openRun: { runId: string; runtimeId?: string } | null
  page: PageId
  goPage: (id: PageId) => void
}): {
  planPage: PlanPages
  setPlanPage: (next: PlanPages) => void
} {
  const [section, setSection] = useState<PlanSection | undefined>(undefined)
  const planPage: PlanPages =
    page === 'plans' || page === 'tasks' ? { page, ...(section !== undefined ? { section } : {}) } : null
  const setPlanPage = (next: PlanPages): void => {
    setSection(next?.section)
    goPage(next ? next.page : 'agents')
  }
  const opened = openRun ? `${openRun.runtimeId ?? ''}:${openRun.runId}` : null
  useEffect(() => {
    if (opened) goPage('plans')
  }, [opened]) // eslint-disable-line react-hooks/exhaustive-deps
  return { planPage, setPlanPage }
}

const SECTION_KEY = (jobId: string): string => `cm.planSection.${jobId}`

/** The section last used for a plan (DESIGN.md: "the last one used is remembered per plan"). */
export function storedSection(jobId: string): PlanSection {
  try {
    return planSectionOf(localStorage.getItem(SECTION_KEY(jobId)))
  } catch {
    return 'overview'
  }
}

function storeSection(jobId: string, section: PlanSection): void {
  try {
    localStorage.setItem(SECTION_KEY(jobId), section)
  } catch {
    /* no storage: the plan opens on Overview next time */
  }
}

export type PlansPageProps = Pick<
  AppState,
  | 'actionUi' | 'approve' | 'hostDriver' | 'hostStatus' | 'orchHostGate' | 'parkedSinceMs' | 'pauseScheduleRun' | 'restartCoordinator' | 'resumeScheduleRun' | 'currentProject' | 'detail' | 'detailDoor' | 'layout' | 'openLinkedFolder' | 'openRun' | 'orchSnapshot'
  | 'remoteSnapshot' | 'selectWorkbenchTab' | 'setDetail' | 'setJournalPagesFor' | 'openStart' | 'setOpenRun'
  | 'setSourceJobOpen' | 'setShowNew' | 't'
> & ReturnType<typeof usePlanPages>

export function PlansPage(p: PlansPageProps): React.JSX.Element {
  const {
    actionUi, approve, hostDriver, hostStatus, orchHostGate, parkedSinceMs, pauseScheduleRun, restartCoordinator, resumeScheduleRun, currentProject, detail, detailDoor, layout, openLinkedFolder, openRun, orchSnapshot, remoteSnapshot,
    selectWorkbenchTab, setDetail, setJournalPagesFor, openStart, setOpenRun, setSourceJobOpen, setShowNew, t, planPage,
    setPlanPage
  } = p
  const canOpenSession = (sessionId: string): boolean => !!layout && !!groupOfTab(layout, sessionTab(sessionId))

  if (openRun && detailDoor) {
    const snap = openRun.runtimeId ? remoteSnapshot : orchSnapshot
    const section = planPage?.section ?? storedSection(openRun.runId)
    // Moved from Overlays' RunDetail mount (W9-A), with its comments: the props are the window's, now a page's
    return (
      <div className="plan-pages">
        <PlanPage
          door={detailDoor}
          // 그래프의 노드는 제목·상태·세션을 스냅샷에서 읽는다(detail 의 layers 는 id 뿐이다).
          // 그 Run 이 스냅샷에서 사라졌으면(다른 프로젝트로 갔거나 지워졌다) undefined 다.
          // findRun 인 이유는 위 두 효과와 같다 — 예약 회차는 children 안에 있다(snapshot.ts).
          run={snap ? findRun(snap, openRun.runId) : undefined}
          runtimeId={openRun.runtimeId}
          detail={detail}
          projectPath={openRun.projectPath}
          runId={openRun.runId}
          // the tab tree is the only place that knows whether the worker's tab is still open (JobsView's pair)
          canOpenSession={canOpenSession}
          onOpenSession={(sessionId) => {
            setPlanPage(null) // 탭으로 가면서 닫는다
            selectWorkbenchTab(sessionTab(sessionId))
          }}
          onShowOlderJournal={() =>
            setJournalPagesFor((prev) => ({
              runId: openRun.runId,
              pages: (prev?.runId === openRun.runId ? prev.pages : 1) + 1
            }))
          }
          onClose={() => setOpenRun(null)}
          // W6-E progress view: a plan's affected path, shown in the explorer (its folder, as a folder link is)
          onOpenPath={
            openRun.runtimeId
              ? undefined
              : (rel) => {
                  setPlanPage(null)
                  openLinkedFolder(parentDir(resolveRelative(`${openRun.projectPath}/.`, rel)))
                }
          }
          section={section}
          onSection={(s) => {
            storeSection(openRun.runId, s)
            setPlanPage({ page: 'plans', section: s })
          }}
          plans={snap?.runs ?? []}
          snapshot={snap}
          onOpenConsoles={() => openPage('agents', openRun.runId)}
        />
      </div>
    )
  }

  const local = currentProject ? localDoor(window.api, currentProject) : null
  // the handlers JobsView's list took, for every row (lib/jobActions: delete and archive confirm first)
  const acts: PlanActs = {
    onOpen: (runId) => {
      setDetail(null) // 이전 Run 의 상세가 한 프레임 보이지 않게 한다
      setPlanPage({ page: 'plans' })
      if (currentProject) setOpenRun({ projectPath: currentProject, runId })
    },
    canOpenSession,
    onOpenSession: (sessionId) => {
      setPlanPage(null)
      selectWorkbenchTab(sessionTab(sessionId))
    },
    onPause: pauseScheduleRun,
    onResume: resumeScheduleRun,
    onRestartCoordinator: restartCoordinator,
    onApprove: (runId) => {
      if (local) approve(local, orchSnapshot, runId, actionUi)
    },
    onDelete: (runId) => local && void deleteRun(local, orchSnapshot, runId, actionUi),
    onRename: (jobId, title) => local && void renameJob(local, jobId, title, actionUi),
    onArchive: (jobId) => local && void archiveJob(local, orchSnapshot, jobId, actionUi),
    onUnarchive: (jobId) => local && void unarchiveJob(local, jobId, actionUi),
    onHold: (jobId, hold) => local && void holdJob(local, jobId, hold, actionUi),
    onResolveFailed: (taskId, action) => local && void resolveFailed(local, taskId, action, actionUi)
  }
  return (
    <div className="plan-pages plans-page">
      <PlanList
        snapshot={orchSnapshot}
        hostGate={orchHostGate}
        // why nothing moves (limit L3): a held Host, a Host that does not answer
        stall={jobsStall({ hostStatus, driver: hostDriver, parkedSinceMs, nowMs: Date.now() })}
        projectPath={currentProject ?? undefined}
        acts={acts}
        // T2: one create page — New job opens Start, as New / Ctrl+N does
        onNewRun={() => currentProject && openStart({})}
        onNewFromSource={() => currentProject && setSourceJobOpen(currentProject)}
        onNewConsole={() => setShowNew(true)}
        overlap={<OverlapTable rows={orchSnapshot?.runs ?? []} t={t} onOpen={acts.onOpen} />}
        mainPlan={<MainPlan rows={orchSnapshot?.runs ?? []} acts={acts} />}
      />
    </div>
  )
}

/** "Overlap": plans × top folders, a folder two plans still work in highlighted. */
function OverlapTable({ rows, t, onOpen }: { rows: readonly JobRow[]; t: AppState['t']; onOpen: (jobId: string) => void }): React.JSX.Element {
  const table = overlapTableOf(rows)
  if (table.folders.length === 0) return <EmptyState icon={ICONS.layers} title={t('pages.plans.noFolders')} />
  const cellText = (c: OverlapCell): string =>
    c === null ? '' : c.kind === 'editing' ? t('pages.plans.cell.editing', { task: c.task }) : t(`pages.plans.cell.${c.kind}`)
  return (
    <div className="plans-overlap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('pages.plans.title')}</th>
            {table.folders.map((f) => (
              <th key={f} scope="col" className={table.shared.has(f) ? 'shared' : undefined} title={table.shared.has(f) ? t('pages.plans.sharedHint') : undefined}>
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(({ row, cells }) => (
            <tr key={row.id}>
              <th scope="row">
                <Button variant="ghost" size="sm" className="plan-crumb-link" onClick={() => onOpen(row.id)}>
                  {jobName(row)}
                </Button>
              </th>
              {cells.map((c, i) => (
                <td key={table.folders[i]} className={`${c?.kind ?? 'none'}${table.shared.has(table.folders[i]) && c ? ' shared' : ''}`}>
                  {cellText(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
