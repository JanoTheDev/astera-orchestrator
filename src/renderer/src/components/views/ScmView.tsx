// The Source Control side bar view (DESIGN-W13 §4). Adapter until its own Task: the Worktrees page's list; a worktree
// opens in its `view:worktree` tab.
import { useCallback } from 'react'
import { WorktreePanel } from '../WorktreePanel'
import { useWorktreeView } from '../worktrees/worktreeView'
import { repoInScope } from '../../state/projectView'
import { openWorktree } from '../shell/navigation'
import type { SideBarViewProps } from '../shell/SideBar'

export function ScmView(p: SideBarViewProps): React.JSX.Element {
  const { selected } = useWorktreeView()
  const { workspaceTree, scopeId } = p
  const repoFilter = useCallback((repo: string) => repoInScope(workspaceTree, scopeId, repo), [workspaceTree, scopeId])
  return (
    <div className="wb-view wb-view--scm">
      <WorktreePanel
        selected={selected}
        onSelect={openWorktree}
        onStartSession={(path) => {
          p.setNewSessionCwd(path)
          p.setShowNew(true)
        }}
        repoFilter={repoFilter}
      />
    </div>
  )
}
