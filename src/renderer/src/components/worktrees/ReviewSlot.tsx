// The review surface's slot in the worktree tab, below "Changes": the change map and the code with its hunk actions
// (review/ReviewView). The tab says which plan, and which of its Tasks, the worktree belongs to.
import type { JobRow, JobTask, WorktreeListItem } from '../../../../core/types'
import type { OrchDoor } from '../../lib/orchDoor'
import { ReviewView } from '../review/ReviewView'

export interface ReviewSlotProps {
  /** The worktree the tab is for: the change map is `review.changeMap({ cwd: worktree.path, base: worktree.baseRef })`. */
  worktree: WorktreeListItem
  /** The plan the worktree belongs to, and the Task when it is one Task's branch. */
  plan?: JobRow
  task?: JobTask
  door: OrchDoor | null
}

export function ReviewSlot({ worktree, plan, task, door }: ReviewSlotProps): React.JSX.Element | null {
  if (worktree.status !== 'ok') return null
  return <ReviewView cwd={worktree.path} base={worktree.baseRef} owner={plan ? { plan, ...(task ? { task } : {}) } : undefined} door={door} />
}
