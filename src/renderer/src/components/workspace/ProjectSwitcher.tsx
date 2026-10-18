import type { SessionInfo } from '../../../../core/types'
import { workspaceSummaries, type WorkspaceProject } from './workspaceTree'
import { useAttention } from './useAttention'
import './workspace.css'

/** W6-F: one row per project workspace, with its running tabs and a dot while one waits for the owner. Clicking the
 *  open one again goes back to every tab. The first nine also open with the `workspace.projectN` keys. */
export function ProjectSwitcher({
  tree,
  byWorkspace,
  sessions,
  selectedId,
  onSelect
}: {
  tree: WorkspaceProject[]
  /** workspaceSessionIds: each workspace's session ids. */
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  sessions: SessionInfo[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element | null {
  const attention = useAttention([...byWorkspace.values()].flatMap((ids) => [...ids]))
  const rows = workspaceSummaries(tree, byWorkspace, sessions, attention)
  if (rows.length === 0) return null
  return (
    <nav className="ws-switcher" aria-label="Project workspaces">
      <button className={`ws-switch${selectedId === null ? ' selected' : ''}`} aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
        <span className="ws-name">All tabs</span>
      </button>
      {rows.map((r, i) => (
        <button
          key={r.id}
          className={`ws-switch${r.id === selectedId ? ' selected' : ''}`}
          aria-pressed={r.id === selectedId}
          title={i < 9 ? `Ctrl+Alt+${i + 1}` : undefined}
          onClick={() => onSelect(r.id === selectedId ? null : r.id)}
        >
          {r.waiting && <span className="ws-dot ws-waiting" aria-label="needs input" />}
          <span className="ws-name">{r.name}</span>
          <span className="ws-count" aria-label={`${r.running} running`}>
            {r.running}
          </span>
        </button>
      ))}
    </nav>
  )
}
