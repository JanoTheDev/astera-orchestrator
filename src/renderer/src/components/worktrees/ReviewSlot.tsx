// The review surface's slot in the worktree tab, below "Changes". A follow-up Task fills it with the change map and the
// hunk actions; the tab only promises this boundary (props and place), not what is drawn in it.
import type { WorktreeListItem } from '../../../../core/types'

export interface ReviewSlotProps {
  /** The worktree the tab is for: the change map is `review.changeMap({ cwd: worktree.path, base: worktree.baseRef })`. */
  worktree: WorktreeListItem
}

/** Draws nothing yet. */
export function ReviewSlot(_props: ReviewSlotProps): React.JSX.Element | null {
  return null
}
