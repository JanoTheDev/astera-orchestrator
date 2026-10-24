// The window's current project, as any component reads it: the title bar's selection and what follows from it
// (projectScopeOf). useWorkspace derives it and App provides it, so a page needs no props threaded down for it.
import { createContext, useContext } from 'react'
import type { ProjectScopeView } from './projectView'

export interface ProjectScope extends Omit<ProjectScopeView, 'scopeId'> {
  /** Selects a project in the title bar (null = All projects): useWorkspace's openWorkspaceProject. */
  select: (projectId: string | null) => void
}

export const ProjectScopeContext = createContext<ProjectScope | null>(null)

export function useProjectScope(): ProjectScope {
  const scope = useContext(ProjectScopeContext)
  if (!scope) throw new Error('useProjectScope outside ProjectScopeContext (App provides it)')
  return scope
}
