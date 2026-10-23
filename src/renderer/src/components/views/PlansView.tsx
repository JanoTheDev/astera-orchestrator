// The Plans side bar view (DESIGN-W13 §4). Adapter until its own Task: the Plans page's list (and its All tasks view);
// a plan opens in its own `view:plan` tab, so the list here never turns into the plan page. A paired Runtime's plans keep
// their selector and list, as on the old Plans page.
import { useState } from 'react'
import { Icon, Tabs } from '../ui'
import { RuntimeSelector } from '../RuntimeSelector'
import { JobsView } from '../JobsView'
import { PlansPage } from '../pages/PlansPage'
import { TasksPage } from '../pages/TasksPage'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { deleteRun, pauseRun, restartCoordinator as restartRunCoordinator, resumeRun } from '../../lib/jobActions'
import { openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'

export function PlansView(p: SideBarViewProps): React.JSX.Element {
  const { t, pairedRuntimes, jobsRuntime, remoteSnapshot, remoteProject, remoteViewPermission, remoteViewDoor, remoteActionUi } = p
  const [view, setView] = useState<'plans' | 'tasks'>('plans')
  const runtimeName = pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.name ?? jobsRuntime
  return (
    <div className="wb-view wb-view--scroll">
      <ViewToolbar
        label={t('shell.activity.plans')}
        items={[
          { id: 'new', icon: <Icon name="add" />, label: t('shell.plans.new'), disabled: !p.currentProject, onClick: () => openView('start') },
          { id: 'main', icon: <Icon name="target" />, label: t('shell.view.mainplan'), onClick: () => openView('mainplan') }
        ]}
      />
      <div className="page-views">
        <Tabs
          variant="segmented"
          label={t('shell.plans.views')}
          items={[
            { id: 'plans', label: t('shell.plans.viewPlans') },
            { id: 'tasks', label: t('shell.plans.viewTasks') }
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      {view === 'tasks' ? (
        <TasksPage {...p} />
      ) : (
        <>
          {pairedRuntimes.length > 0 && (
            <RuntimeSelector
              readOnlyReason={controlReason(remoteViewPermission, t as never)}
              paired={pairedRuntimes}
              runtimeId={jobsRuntime}
              onRuntime={p.setJobsRuntime}
              projects={p.remoteProjects}
              project={remoteProject}
              onProject={p.setRemoteProject}
              offline={offlineNote(
                remoteSnapshot?.runtime,
                runtimeName,
                // The last answer this app had (review I4); the pairing time only before any answer.
                remoteSnapshot?.runtime?.lastSeenAt ?? pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.lastSeenAt ?? null,
                t as never,
                (iso) => new Date(iso).toLocaleString()
              )}
            />
          )}
          {isRemoteRuntime(jobsRuntime) ? (
            // A paired Runtime's Jobs, acted on there through its door (Phase 7), disabled with the reason for a
            // read-only pairing.
            <JobsView
              snapshot={remoteSnapshot}
              hostGate={null}
              stall={null}
              hasProject={remoteProject !== null}
              remote
              disabledReason={controlReason(remoteViewPermission, t as never) ?? undefined}
              newDisabledReason={t('jobs.new.localOnly')}
              canOpenSession={() => false}
              onOpenSession={() => {}}
              onOpenRun={(runId) => {
                p.setDetail(null)
                if (remoteProject) p.setOpenRun({ projectPath: remoteProject, runId, runtimeId: jobsRuntime })
              }}
              onNewRun={() => {}}
              onPauseRun={(runId) => remoteViewDoor && void pauseRun(remoteViewDoor, runId, remoteActionUi)}
              onResumeRun={(runId) => remoteViewDoor && void resumeRun(remoteViewDoor, runId, remoteActionUi)}
              onDeleteRun={(runId) => remoteViewDoor && void deleteRun(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)}
              onRestartCoordinator={(runId) => remoteViewDoor && void restartRunCoordinator(remoteViewDoor, runId, remoteActionUi)}
              onApprove={(runId) => remoteViewDoor && p.approve(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)}
            />
          ) : (
            // the list, never the plan page: the plan is its tab's (shell/viewTabs.tsx)
            <PlansPage {...p} openRun={null} />
          )}
        </>
      )}
    </div>
  )
}
