// The Host's completion check plugins (plugin Phase 5 C1, C2, C5, C7), as the checks and the early refusals reach them:
// every installed plugin with whether its manifest names `completion-check` and whether it is enabled, and a check asked
// of one through the runtime's request with CHECK_TIMEOUT_MS, the command checks' own limit. What it answers is checked
// and cut (checkAnswerOf); a plugin missing, not running, throwing, answering late or answering nonsense is an `error`
// answer saying why, never a rejection: the check runner reads that as a check that could not be made (C9).
import type { CompletionChecksDeps } from '../core/orchestration/command'
import { checkAnswerOf, pluginCheckMissing, unavailable } from '../core/orchestration/pluginChecks'
import { CHECK_TIMEOUT_MS } from '../core/orchestration/types'
import type { PluginManager } from './plugins/manager'
import { PluginRequestFailed, type PluginRuntime } from './plugins/runtime'

/** A limit as a person reads it: minutes when it is whole minutes, else seconds. */
const spoken = (ms: number): string => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms / 1000} s`)

export function hostCompletionChecks(d: {
  manager: Pick<PluginManager, 'listNow'>
  runtime: Pick<PluginRuntime, 'request'>
  timeoutMs?: number
}): CompletionChecksDeps {
  const timeoutMs = d.timeoutMs ?? CHECK_TIMEOUT_MS
  const plugins: CompletionChecksDeps['plugins'] = async () => {
    const r = await d.manager.listNow()
    if (r.status !== 200) return null
    const views = ((r.body as { plugins?: unknown }).plugins ?? []) as Array<Record<string, unknown>>
    return views.map((v) => {
      const id = String(v.id)
      return {
        id,
        displayName: typeof v.displayName === 'string' ? v.displayName : id,
        check: Array.isArray(v.capabilities) && v.capabilities.includes('completion-check'),
        enabled: v.enabled === true
      }
    })
  }
  return {
    plugins,
    run: async (plugin, input) => {
      const listed = await plugins().catch(() => null)
      const found = listed?.find((p) => p.id === plugin)
      const name = found?.displayName ?? plugin
      // A list that could not be read judges nothing: the plugin is asked, and the runtime says if it does not run
      const missing = listed === null ? null : pluginCheckMissing(plugin, found)
      if (missing !== null) return { name, ...unavailable(missing) }
      try {
        return { name, ...checkAnswerOf(await d.runtime.request(plugin, 'completionCheck.run', { input }, timeoutMs)) }
      } catch (e) {
        const reason =
          e instanceof PluginRequestFailed && e.status === 504
            ? `${plugin} did not answer within ${spoken(timeoutMs)}`
            : e instanceof Error
              ? e.message
              : String(e)
        return { name, ...unavailable(reason) }
      }
    }
  }
}
