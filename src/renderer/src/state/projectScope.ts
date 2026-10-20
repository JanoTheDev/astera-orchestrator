// The top bar's project switcher is the window's one current project. These rules say when that selection changes:
// only by a pick, or by opening something of a different project. Never to "All projects" by accident.
import { familyOf, OTHER_WORKSPACE, type WorkspaceProject } from './workspaceTree'

/** The project that owns a session, or undefined while it is unknown: a session not yet in the tree (a freshly spawned
 *  planner, before the 5 s poll) reads as Other's, and that is no reason to leave the selected project. */
export function ownerOf(byWorkspace: ReadonlyMap<string, ReadonlySet<string>>, sessionId: string): string | undefined {
  for (const [id, ids] of byWorkspace) if (id !== OTHER_WORKSPACE && ids.has(sessionId)) return id
  return undefined
}

/** The selection after opening something owned by `owner`: that project when it differs, else the current one. */
export const scopeFor = (current: string | null, owner: string | undefined): string | null => owner ?? current

export type SwitcherName = { kind: 'all' } | { kind: 'other' } | { kind: 'name'; name: string } | { kind: 'pending' }

/** What the switcher button names. `remembered` is the last name seen for the selected id: before the tree loads
 *  (after a reload) it stands in, and with none the label is neutral ('pending'), never "All projects". */
export function switcherName(selectedId: string | null, tree: readonly WorkspaceProject[], remembered: string | null): SwitcherName {
  if (selectedId === null) return { kind: 'all' }
  if (selectedId === OTHER_WORKSPACE) return { kind: 'other' }
  const name = tree.find((p) => p.id === selectedId)?.name ?? remembered
  return name ? { kind: 'name', name } : { kind: 'pending' }
}

/** T6: the projects a pick shows. A root is itself and its sub-projects (combined plans, Tasks and tabs); a
 *  sub-project is only itself. Null (All projects) is every project. */
export function scopeProjectIds(tree: readonly WorkspaceProject[], selectedId: string | null): string[] | null {
  if (selectedId === null) return null
  return selectedId === OTHER_WORKSPACE ? [OTHER_WORKSPACE] : familyOf(tree, selectedId)
}

/** T6: the scope a window starts with. Its stored one, even All; none yet means "not known": show no tabs until main
 *  says which project the window is bound to, rather than flashing every project's. */
export const initialScope = (stored: string | null | undefined): { projectId: string | null; known: boolean } =>
  stored === undefined ? { projectId: null, known: false } : { projectId: stored, known: true }
