import type { RunConfig, SaveConfigsResult } from '../../core/run/types'
import { validateConfigs } from '../../core/run/validateConfigs'

/** The Run Configurations dialog's Apply: the project's stored list becomes `configs`, wholesale — an
 *  item missing from the list is deleted, a new id added, a known id replaced, and the list's order is
 *  the order stored. Every item is checked before anything is written and one failure fails the batch,
 *  with every offending item named, so the dialog never sees a half-applied store. The project path
 *  itself is guarded by the caller (assertAllowedPath) — a disallowed project is a programming error,
 *  not user input, and throws as before. */
export async function saveConfigsBatch(a: {
  projectPath: string
  configs: RunConfig[]
  platform: NodeJS.Platform
  assertConfigCwd: (projectPath: string, cwd: unknown) => Promise<void>
  store: { save(projectPath: string, configs: RunConfig[]): Promise<void> }
}): Promise<SaveConfigsResult> {
  const errors = await validateConfigs(a)
  if (errors.length > 0) return { ok: false, errors }
  await a.store.save(a.projectPath, a.configs)
  return { ok: true, configs: a.configs }
}
