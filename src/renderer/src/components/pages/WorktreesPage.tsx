// The worktree detail for the shell's `worktree` view tab and the legacy `worktrees` page slot: no page chrome of its
// own any more. The list lives in the Source Control view; this shows the worktree it selected.
import { WorktreeDetail } from '../worktrees/WorktreeDetail'
import { useWorktreeView } from '../worktrees/worktreeView'

export function WorktreesPage({
  onStartSession,
  onOpenFiles,
  repoFilter
}: {
  onStartSession: (path: string) => void
  onOpenFiles: (path: string) => void
  /** The legacy page slot passes it; the page it closed is a tab now. */
  onClose?: () => void
  repoFilter?: (repoPath: string) => boolean
}): React.JSX.Element {
  const { selected } = useWorktreeView()
  return <WorktreeDetail path={selected} onStartSession={onStartSession} onOpenFiles={onOpenFiles} repoFilter={repoFilter} />
}
