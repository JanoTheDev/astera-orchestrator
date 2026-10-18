import type { SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, workspaceSummaries, type WorkspaceProject } from './workspaceTree'
import { useAttention } from './useAttention'
import './workspace.css'

/** W6-F: one row per project workspace, with its running tabs and a dot while one waits for the owner. Clicking the
 *  open one again goes back to every tab. The first nine also open with the `workspace.projectN` keys. */
export function ProjectSwitcher({
  tree,
  byWorkspace,
  sessions,
  selectedId,
  onSelect,
  onNew,
  onAdd,
  onSettings,
  toolsDisabledReason
}: {
  tree: WorkspaceProject[]
  /** workspaceSessionIds: each workspace's session ids. */
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  sessions: SessionInfo[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** W7-B: new / add project and a project's settings. */
  onNew?: () => void
  onAdd?: () => void
  onSettings?: (id: string) => void
  /** Why the buttons are off (no tab open to anchor the commands), or undefined. */
  toolsDisabledReason?: string
}): React.JSX.Element | null {
  const attention = useAttention([...byWorkspace.values()].flatMap((ids) => [...ids]))
  const rows = workspaceSummaries(tree, byWorkspace, sessions, attention)
  if (rows.length === 0 && !onNew && !onAdd) return null
  return (
    <nav className="ws-switcher" aria-label="Project workspaces">
      <button className={`ws-switch${selectedId === null ? ' selected' : ''}`} aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
        <span className="ws-name">All tabs</span>
      </button>
      {rows.map((r, i) => (
        <span key={r.id} style={{ display: 'contents' }}>
          <button
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
          {/* W7-B: the project's settings page; "Other" is no project */}
          {onSettings && r.id !== OTHER_WORKSPACE && (
            <button
              className="ws-switch ws-gear"
              aria-label={`${r.name} settings`}
              title={toolsDisabledReason ?? 'Project settings'}
              disabled={!!toolsDisabledReason}
              onClick={() => onSettings(r.id)}
            >
              ⚙
            </button>
          )}
        </span>
      ))}
      {/* W7-B */}
      {(onNew || onAdd) && (
        <div className="ws-tools">
          <button className="ws-switch" disabled={!!toolsDisabledReason} title={toolsDisabledReason} onClick={onNew}>
            + New project
          </button>
          <button className="ws-switch" disabled={!!toolsDisabledReason} title={toolsDisabledReason} onClick={onAdd}>
            Add project
          </button>
        </div>
      )}
    </nav>
  )
}
