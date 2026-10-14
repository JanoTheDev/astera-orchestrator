// The app's way to the Host's completion check plugins (plugin Phase 5 C7, C8). Plugins run in the Host: where the app
// drives a Task's checks, a `plugin:` check is asked through `checks-plugin-run`, and the app's own command copy reads
// which plugins there are through `plugins-list`, both over the app's `orch-call` as the app. The Host checks and cuts
// the answer; it is checked again here, since what reaches the state must hold the same limits whoever drove it.
//
// **Nothing here rejects.** A Host that cannot be asked, does not answer in time or refuses is an `error` answer: the
// checks read it as a check that could not be made (asked once more, then a question), never as the code's failure.
import type { CompletionChecksDeps } from '../../core/orchestration/command'
import { checkAnswerOf, unavailable } from '../../core/orchestration/pluginChecks'
import { CHECK_TIMEOUT_MS } from '../../core/orchestration/types'
import { TIMEOUT_HEADROOM_MS } from '../../core/publicContract'

/** How long the app waits for a plugin's check: the Host's own limit and the headroom, so the Host's "did not answer
 *  within 30 minutes" is what a person reads rather than the app's deadline racing it. */
export const PLUGIN_CHECK_DEADLINE_MS = CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS

type Call = (m: { cmd: string; args: Record<string, unknown>; sessionId: string; timeoutMs?: number }) => Promise<{ status: number; body: unknown }>

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function createAppCompletionChecks(d: { call: Call }): CompletionChecksDeps {
  return {
    plugins: async () => {
      let r: { status: number; body: unknown }
      try {
        r = await d.call({ cmd: 'plugins-list', args: {}, sessionId: '' })
      } catch {
        return null
      }
      if (r.status !== 200 || !isObject(r.body) || !Array.isArray(r.body.plugins)) return null
      return (r.body.plugins as unknown[]).filter(isObject).map((v) => {
        const id = String(v.id)
        return {
          id,
          displayName: typeof v.displayName === 'string' ? v.displayName : id,
          check: Array.isArray(v.capabilities) && v.capabilities.includes('completion-check'),
          enabled: v.enabled === true
        }
      })
    },
    run: async (plugin, input) => {
      let r: { status: number; body: unknown }
      try {
        r = await d.call({ cmd: 'checks-plugin-run', args: { plugin, input }, sessionId: '', timeoutMs: PLUGIN_CHECK_DEADLINE_MS })
      } catch (e) {
        return { name: plugin, ...unavailable(`the Host could not be asked: ${e instanceof Error ? e.message : String(e)}`) }
      }
      const body = isObject(r.body) ? r.body : {}
      if (r.status !== 200)
        return { name: plugin, ...unavailable(typeof body.error === 'string' ? body.error : `the Host answered ${r.status}`) }
      const name = typeof body.name === 'string' && body.name !== '' ? body.name : plugin
      return { name, ...checkAnswerOf(body) }
    }
  }
}
