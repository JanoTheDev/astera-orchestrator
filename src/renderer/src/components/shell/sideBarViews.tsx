// DESIGN-W13 §4: which view each activity shows. One file per view in components/views/, each owned by its own Task;
// this registry only imports them.
import type { ActivityId } from '../../../../core/ui/pages'
import type { MessageKey } from '../../../../core/i18n'
import { AgentsView } from '../views/AgentsView'
import { PlansView } from '../views/PlansView'
import { ExplorerView } from '../views/ExplorerView'
import { ScmView } from '../views/ScmView'
import { HistoryView } from '../views/HistoryView'
import { RunView } from '../views/RunView'
import { DevicesView } from '../views/DevicesView'
import { PullRequestsView } from '../views/PullRequestsView'
import type { SideBarViewProps } from './SideBar'

export const SIDE_BAR_VIEWS: Record<ActivityId, { title: MessageKey; View: (p: SideBarViewProps) => React.JSX.Element | null }> = {
  agents: { title: 'shell.activity.agents', View: AgentsView },
  plans: { title: 'shell.activity.plans', View: PlansView },
  explorer: { title: 'shell.activity.explorer', View: ExplorerView },
  scm: { title: 'shell.activity.scm', View: ScmView },
  history: { title: 'shell.activity.history', View: HistoryView },
  run: { title: 'shell.activity.run', View: RunView },
  devices: { title: 'shell.activity.devices', View: DevicesView },
  prs: { title: 'shell.activity.prs', View: PullRequestsView }
}
