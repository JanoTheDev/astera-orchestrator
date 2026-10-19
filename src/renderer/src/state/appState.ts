// The state App's hooks return, as one type: the shell components pick their props from it (W9-A).
import type { useLayout } from './useLayout'
import type { useHost } from './useHost'
import type { useSidebar } from './useSidebar'
import type { useSettings } from './useSettings'
import type { useWorkbenchState } from './useWorkbenchState'
import type { useDialogs } from './useDialogs'
import type { useWorkbench } from './useWorkbench'
import type { useRunPanel } from './useRunPanel'
import type { useJobs } from './useJobs'
import type { useViews } from './useViews'
import type { useWorkspace } from './useWorkspace'
import type { useLiveData } from './useLiveData'
import type { useRunActions } from './useRunActions'
import type { usePlanPages } from '../components/pages/PlansPage' // W9-C

export type AppState = ReturnType<typeof useLayout> &
  ReturnType<typeof useHost> &
  ReturnType<typeof useSidebar> &
  ReturnType<typeof useSettings> &
  ReturnType<typeof useWorkbenchState> &
  ReturnType<typeof useDialogs> &
  ReturnType<typeof useWorkbench> &
  ReturnType<typeof useRunPanel> &
  ReturnType<typeof useJobs> &
  ReturnType<typeof useViews> &
  ReturnType<typeof useWorkspace> &
  ReturnType<typeof useLiveData> &
  ReturnType<typeof useRunActions> &
  ReturnType<typeof usePlanPages>
