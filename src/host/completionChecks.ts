// The Host's completion check plugins (plugin Phase 5 C1, C2, C5, C7), as the checks and the early refusals reach them:
// every installed plugin with whether its manifest names `completion-check` and whether it is enabled, and a check asked
// of one through the runtime's request with CHECK_TIMEOUT_MS, the command checks' own limit. What it answers is checked
// and cut (checkAnswerOf); a plugin missing, not running, throwing, answering late or answering nonsense is an `error`
// answer saying why, never a rejection: the check runner reads that as a check that could not be made (C9).
//
// **A plugin still coming up is waited for, a while** (5a final review M1): a Host that has just started is starting its
// plugins as its sweep re-drives the checks a restart interrupted, and a check asked at once would put a question to a
// person over Astera's own restart.
import type { CompletionChecksDeps } from '../core/orchestration/command'
import { checkAnswerOf, pluginCheckMissing, unavailable } from '../core/orchestration/pluginChecks'
import { CHECK_TIMEOUT_MS } from '../core/orchestration/types'
import type { PluginManager } from './plugins/manager'
import { PluginRequestFailed, type PluginRuntime } from './plugins/runtime'

/** How long a check waits for its plugin to come up: a start, or a restart's backoff, is seconds. */
export const PLUGIN_START_WAIT_MS = 60_000
const POLL_MS = 500

/** A limit as a person reads it: minutes when it is whole minutes, else seconds. */
const spoken = (ms: number): string => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms / 1000} s`)

type View = Record<string, unknown>

/** Whether an enabled plugin is on its way to running: starting, or not started yet (an enabled plugin with nothing
 *  holding it back reads `stopped` until the Host's start reaches it). One held back says why, in `reason`. */
const comingUp = (v: View): boolean => v.enabled === true && (v.status === 'starting' || (v.status === 'stopped' && v.reason === undefined))

export function hostCompletionChecks(d: {
  manager: Pick<PluginManager, 'listNow'>
  runtime: Pick<PluginRuntime, 'request'>
  timeoutMs?: number
  /** Test seams: PLUGIN_START_WAIT_MS and the poll between looks. */
  startWaitMs?: number
  pollMs?: number
}): CompletionChecksDeps {
  const timeoutMs = d.timeoutMs ?? CHECK_TIMEOUT_MS
  const startWaitMs = d.startWaitMs ?? PLUGIN_START_WAIT_MS
  const pollMs = d.pollMs ?? POLL_MS
  /** The installed plugins as the manager shows them, or null when it cannot. */
  const views = async (): Promise<View[] | null> => {
    const r = await d.manager.listNow().catch(() => null)
    if (r === null || r.status !== 200) return null
    return ((r.body as { plugins?: unknown }).plugins ?? []) as View[]
  }
  const pluginOf = (v: View) => {
    const id = String(v.id)
    return {
      id,
      displayName: typeof v.displayName === 'string' ? v.displayName : id,
      check: Array.isArray(v.capabilities) && v.capabilities.includes('completion-check'),
      enabled: v.enabled === true
    }
  }
  /** The plugin's view, once it is no longer coming up or the wait is over; null when the list cannot be read. */
  const settled = async (plugin: string): Promise<{ listed: boolean; view: View | undefined }> => {
    const deadline = Date.now() + startWaitMs
    for (;;) {
      const vs = await views()
      const view = vs?.find((v) => String(v.id) === plugin)
      if (vs === null || view === undefined || !comingUp(view) || Date.now() >= deadline) return { listed: vs !== null, view }
      await new Promise((r) => setTimeout(r, pollMs))
    }
  }
  return {
    plugins: async () => (await views())?.map(pluginOf) ?? null,
    run: async (plugin, input) => {
      const { listed, view } = await settled(plugin)
      const found = view ? pluginOf(view) : undefined
      const name = found?.displayName ?? plugin
      // A list that could not be read judges nothing: the plugin is asked, and the runtime says if it does not run
      const missing = listed ? pluginCheckMissing(plugin, found) : null
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
