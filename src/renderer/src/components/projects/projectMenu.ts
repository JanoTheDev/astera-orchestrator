// What a project row offers by the state of its folder (the project switcher's right-click menu, Project Settings):
// a folder that is gone or is no git repository gets a chip, and the actions that need the folder step aside.
// Pure, so the node-only suite reaches it.
import type { RepoProbe } from '../../../../core/types'

export type ProjectState = 'ok' | 'missing' | 'notGit'

/** `exists` is system.pathExists, `repo` the kind worktrees.isGitRepo answered; undefined while either is unasked. An
 *  `unknown` probe is no verdict (a slow share), so it reads as ok. */
export function projectStateOf(f: { exists: boolean | undefined; repo: RepoProbe['kind'] | undefined }): ProjectState {
  if (f.exists === false) return 'missing'
  return f.repo === 'none' ? 'notGit' : 'ok'
}

/** The chip a state shows (word and icon, both from the state); null for a healthy project. */
export const PROJECT_CHIP = { missing: { icon: 'warning', key: 'project.state.missing' }, notGit: { icon: 'branch', key: 'project.state.notGit' } } as const

export type ProjectAction = 'open' | 'window' | 'settings' | 'reveal' | 'remove'

/** The switcher row's menu, in order. Open in new window only where windows exist; Settings and Remove need the project
 *  tools (a tab to anchor the commands); Reveal needs the folder. Remove stays open for a missing folder: it is how
 *  a project whose folder was deleted leaves the list. */
export function projectActions(o: { state: ProjectState; canWindow: boolean; tools: boolean }): Array<{ id: ProjectAction; disabled?: true }> {
  return [
    { id: 'open' },
    ...(o.canWindow ? [{ id: 'window' as const }] : []),
    { id: 'settings', ...(o.tools ? {} : { disabled: true as const }) },
    { id: 'reveal', ...(o.state === 'missing' ? { disabled: true as const } : {}) },
    { id: 'remove', ...(o.tools ? {} : { disabled: true as const }) }
  ]
}
