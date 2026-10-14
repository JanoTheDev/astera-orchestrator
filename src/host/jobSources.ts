// The Host's job-source plugins (plugin Phase 4 J6, J10), as the job-source commands reach them: the plugins whose
// installed manifest names `job-source`, ready when the runtime runs them and otherwise with their status and reason (a
// disabled one too, so a call to it hears why: Review Focus 3); and a question to one, through the runtime's request
// with JOB_SOURCE_TIMEOUT_MS. The list is read beside the plugin manager's changes, never behind them (4a final review
// I4): an npm install can take minutes.
import type { JobSourcesDeps } from '../core/orchestration/commandSources'
import type { PluginManager } from './plugins/manager'
import type { PluginRuntime } from './plugins/runtime'

/** How long a person waits for a job source to answer (J6). */
export const JOB_SOURCE_TIMEOUT_MS = 15_000

export function hostJobSources(d: {
  manager: Pick<PluginManager, 'listNow'>
  runtime: Pick<PluginRuntime, 'request'>
  timeoutMs?: number
}): JobSourcesDeps {
  return {
    plugins: async () => {
      const r = await d.manager.listNow()
      if (r.status !== 200) return []
      const views = ((r.body as { plugins?: unknown }).plugins ?? []) as Array<Record<string, unknown>>
      return views
        .filter((v) => Array.isArray(v.capabilities) && v.capabilities.includes('job-source'))
        .map((v) => {
          const id = String(v.id)
          const ready = v.status === 'running'
          return {
            id,
            displayName: typeof v.displayName === 'string' ? v.displayName : id,
            ready,
            ...(ready ? {} : { reason: `${id} is ${String(v.status)}${typeof v.reason === 'string' ? `: ${v.reason}` : ''}` })
          }
        })
    },
    ask: (id, method, params) => d.runtime.request(id, method, params, d.timeoutMs ?? JOB_SOURCE_TIMEOUT_MS)
  }
}
