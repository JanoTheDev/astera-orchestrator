// W9-C plan page host: a plan's own page (PlanPage, which RunDetail's window became), drawn in its `view:plan` tab
// (shell/viewTabs.tsx), and usePlanPages, App's page state for it. T7: the plans list, the All tasks board and the By
// area / Overlap / Main plan tabs are gone; the Plans side bar tree (views/PlansView.tsx) is the one list.
import { useEffect, useState } from 'react'
import type { PageId } from '../../../../core/ui/pages'
import { findRun } from '../../../../core/orchestration/snapshot'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { parentDir, resolveRelative } from '../../../../core/files/paths'
import type { AppState } from '../../state/appState'
import { openPlanConsoles } from '../shell/navigation'
import { planSectionOf, type PlanSection } from '../plan/planBoard'
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
  | 'detail' | 'detailDoor' | 'layout' | 'openLinkedFolder' | 'openRun' | 'orchSnapshot' | 'remoteSnapshot' | 'selectWorkbenchTab'
  | 'setJournalPagesFor' | 'setOpenRun'
> & ReturnType<typeof usePlanPages>

/** The open plan's page; nothing while no plan is open. */
export function PlansPage(p: PlansPageProps): React.JSX.Element | null {
  const { detail, detailDoor, layout, openLinkedFolder, openRun, orchSnapshot, remoteSnapshot, selectWorkbenchTab, setJournalPagesFor, setOpenRun, planPage, setPlanPage } = p
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
          onOpenConsoles={() => openPlanConsoles(openRun.runId)}
        />
      </div>
    )
  }

  // T7: the list is the Plans side bar view's tree (views/PlansView.tsx); this page is a plan tab's body only
  return null
}
