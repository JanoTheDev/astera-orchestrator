// Refusing a plugin check early (plugin Phase 5 C7, C14): a check list naming `plugin:<id>` whose plugin is not
// installed, does not offer completion checks, or is disabled is refused where a person still has the command in front
// of them (`tasks add`, `jobs run`, `run-start`), not found out after a worker has done the whole Task. The Host refuses
// with its own plugins; a paired Runtime's Host with its own, so a Runtime without the plugin refuses the same way.
//
// **It refuses only what it can judge.** With no plugin list wired, or one that cannot be read, nothing is refused: the
// check itself then answers `error` and a person is asked (C9).
import type { OrchServerDeps } from './command'
import { checkConfigIdsOf } from './convergence'
import { pluginCheckMissing, pluginIdOfCheck } from './pluginChecks'
import type { OrchState } from './state'
import type { Job, Task } from './types'

type Reply = { status: number; body: unknown }

/** 409 with PLUGIN_CAPABILITY_MISSING naming each `plugin:` id of `ids` whose plugin cannot check, or null. */
export async function pluginCheckRefusal(deps: OrchServerDeps, ids: readonly string[]): Promise<Reply | null> {
  const named = [...new Set(ids)].filter((id) => pluginIdOfCheck(id) !== null)
  if (named.length === 0 || !deps.completionChecks) return null
  const listed = await deps.completionChecks.plugins().catch(() => null)
  if (listed === null) return null
  const reasons = named.flatMap((id) => {
    const plugin = pluginIdOfCheck(id)!
    const why = pluginCheckMissing(plugin, listed.find((p) => p.id === plugin))
    return why === null ? [] : [`${id}: ${why}`]
  })
  return reasons.length === 0 ? null : { status: 409, body: { error: reasons.join('; '), code: 'PLUGIN_CAPABILITY_MISSING' } }
}

/** The check ids of `tasks`, each once. */
export const checkIdsOf = (tasks: readonly Task[]): string[] => [...new Set(tasks.flatMap((t) => checkConfigIdsOf(t)))]

/** The Tasks a Job's next Run will hold, as startJobRun chooses them: the Job's own definition Tasks, else its last
 *  Run's. */
export function tasksOfNextRun(s: OrchState, job: Job): Task[] {
  const defs = s.tasks.filter((t) => t.jobId === job.id)
  if (defs.length > 0) return defs
  const last = s.runs
    .filter((r) => r.jobId === job.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)
  return last ? s.tasks.filter((t) => t.runId === last.id) : []
}
