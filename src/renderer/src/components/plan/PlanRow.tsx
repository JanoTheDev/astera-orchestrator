// The plan actions a plan list wires (MainPlan, the Main plan tab). T7: the old list rows are gone; the Plans side bar
// tree (views/PlansView.tsx) is the list and puts these actions on its rows' context menus.

/** The plan actions a caller wires (lib/jobActions: delete and archive confirm there). Absent: not offered. */
export interface PlanActs {
  onOpen: (id: string) => void
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  onApprove?: (id: string) => void
  onDelete?: (id: string) => void
  onRestartCoordinator?: (id: string) => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
  onRename?: (id: string, title: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onHold?: (id: string, hold: boolean) => void
  /** T36: the owner's answer to the failed Task a stalled plan waits on (JobRow.stalledOn) */
  onResolveFailed?: (taskId: string, action: 'retry' | 'accept' | 'cancel') => void
}
