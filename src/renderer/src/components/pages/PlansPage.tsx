// W9-C Plans page (DESIGN.md §2 "Plans"): the project's plans "By area" (Job.areas) or as the "Overlap" table
// (plans × folders), and a plan's own page (PlanPage, which RunDetail's window became). The rows are JobsView's
// cards, with their actions; the order, the groups and the table are planBoard.ts's.
import { useEffect, useState } from 'react'
import type { JobRow } from '../../../../core/types'
import type { PageId } from '../../../../core/ui/pages'
import { findRun } from '../../../../core/orchestration/snapshot'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { parentDir, resolveRelative } from '../../../../core/files/paths'
import type { AppState } from '../../state/appState'
import { localDoor } from '../../lib/orchDoor'
import { archiveJob, deleteRun, holdJob, renameJob, unarchiveJob } from '../../lib/jobActions'
import { jobName } from '../../lib/jobName'
import { JobsView } from '../JobsView'
import { jobsStall } from '../../../../core/orchestration/jobsView'
import { Tabs } from '../ui'
import { openPage } from '../shell/navigation'
import { areaGroupsOf, overlapTableOf, planListOrder, planSectionOf, type OverlapCell, type PlanSection } from '../plan/planBoard'
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

type View = 'area' | 'overlap'

export type PlansPageProps = Pick<
  AppState,
  | 'actionUi' | 'approve' | 'hostDriver' | 'hostStatus' | 'orchHostGate' | 'parkedSinceMs' | 'pauseScheduleRun' | 'restartCoordinator' | 'resumeScheduleRun' | 'currentProject' | 'detail' | 'detailDoor' | 'layout' | 'openLinkedFolder' | 'openRun' | 'orchSnapshot'
  | 'remoteSnapshot' | 'selectWorkbenchTab' | 'setDetail' | 'setJournalPagesFor' | 'setNewRunOpen' | 'setOpenRun'
  | 'setSourceJobOpen' | 't'
> & ReturnType<typeof usePlanPages>

export function PlansPage(p: PlansPageProps): React.JSX.Element {
  const {
    actionUi, approve, hostDriver, hostStatus, orchHostGate, parkedSinceMs, pauseScheduleRun, restartCoordinator, resumeScheduleRun, currentProject, detail, detailDoor, layout, openLinkedFolder, openRun, orchSnapshot, remoteSnapshot,
    selectWorkbenchTab, setDetail, setJournalPagesFor, setNewRunOpen, setOpenRun, setSourceJobOpen, t, planPage,
    setPlanPage
  } = p
  const [view, setView] = useState<View>('area')
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
  const snapshot = orchSnapshot ? { ...orchSnapshot, runs: planListOrder(orchSnapshot.runs) } : null
  return (
    <div className="plan-pages">
      <header className="plans-head">
        <h1>{t('pages.plans.title')}</h1>
        <Tabs<View>
          variant="segmented"
          label={t('pages.plans.title')}
          value={view}
          onChange={setView}
          items={[
            { id: 'area', label: t('pages.plans.byArea') },
            { id: 'overlap', label: t('pages.plans.overlap') }
          ]}
        />
      </header>
      {view === 'overlap' ? (
        <OverlapTable rows={orchSnapshot?.runs ?? []} t={t} onOpen={(id) => currentProject && setOpenRun({ projectPath: currentProject, runId: id })} />
      ) : (
        // The local list the Jobs sidebar drew (Sidebar.tsx), its handlers moved with it; a paired Runtime's plans and
        // its selector are W9-B's Pages.tsx, beside this page
        <JobsView
          snapshot={snapshot}
          hostGate={orchHostGate}
          // why nothing moves (limit L3): a held Host, a Host that does not answer
          stall={jobsStall({ hostStatus, driver: hostDriver, parkedSinceMs, nowMs: Date.now() })}
          hasProject={!!currentProject}
          projectPath={currentProject ?? undefined}
          canOpenSession={canOpenSession}
          onOpenSession={(sessionId) => {
            setPlanPage(null)
            selectWorkbenchTab(sessionTab(sessionId))
          }}
          onOpenRun={(runId) => {
            setDetail(null) // 이전 Run 의 상세가 한 프레임 보이지 않게 한다
            setPlanPage({ page: 'plans' })
            if (currentProject) setOpenRun({ projectPath: currentProject, runId })
          }}
          onNewRun={() => {
            if (currentProject) setNewRunOpen(true)
          }}
          onNewFromSource={() => {
            if (currentProject) setSourceJobOpen(currentProject)
          }}
          onPauseRun={pauseScheduleRun}
          onResumeRun={resumeScheduleRun}
          onRestartCoordinator={restartCoordinator}
          onApprove={(runId) => {
            if (local) approve(local, orchSnapshot, runId, actionUi)
          }}
          onDeleteRun={(runId) => local && void deleteRun(local, orchSnapshot, runId, actionUi)}
          onRenameJob={(jobId, title) => local && void renameJob(local, jobId, title, actionUi)}
          onArchiveJob={(jobId) => local && void archiveJob(local, orchSnapshot, jobId, actionUi)}
          onUnarchiveJob={(jobId) => local && void unarchiveJob(local, jobId, actionUi)}
          onHoldJob={(jobId, hold) => local && void holdJob(local, jobId, hold, actionUi)}
          groupsOf={(rows) =>
            areaGroupsOf(rows).map((g) => ({
              key: g.area,
              rows: g.rows,
              head: (
                <h2 className="plans-area">
                  <span>{g.area || t('pages.plans.noArea')}</span>
                  {g.folders.length > 0 && <span className="plans-area-folders">{g.folders.join(' · ')}</span>}
                </h2>
              )
            }))
          }
        />
      )}
    </div>
  )
}

/** "Overlap": plans × top folders, a folder two plans still work in highlighted. */
function OverlapTable({ rows, t, onOpen }: { rows: readonly JobRow[]; t: AppState['t']; onOpen: (jobId: string) => void }): React.JSX.Element {
  const table = overlapTableOf(rows)
  if (table.folders.length === 0) return <p className="modal-hint">{t('pages.plans.noFolders')}</p>
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
                <button type="button" className="plan-crumb-link" onClick={() => onOpen(row.id)}>
                  {jobName(row)}
                </button>
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
