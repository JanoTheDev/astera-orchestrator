import { describe, it, expect } from 'vitest'
import type { AsteraEvent, EventGap } from '@astera-app/client'
import { definePlugin, type PluginContext } from './index.js'

// That PLUGIN_API_VERSION is one the Host speaks is checked on the app's side (src/core/plugins/manifest.test.ts), so
// this package's checks never compile the app's sources.
describe('@astera-app/plugin-sdk', () => {
  it('definePlugin hands back the plugin it is given, typed', () => {
    const def = { activate: (_ctx: PluginContext) => {} }
    expect(definePlugin(def)).toBe(def)
  })

  // Plugin Phase 3 N5: the event capability's handler
  it('types onEvent with the client’s events, a gap, and the context', () => {
    const seen: string[] = []
    const def = definePlugin({
      onEvent(event: AsteraEvent | EventGap, ctx: PluginContext) {
        if (event.type === 'gap') return
        if (event.type === 'run.failed') ctx.log.info(event.payload.id)
        seen.push(event.id)
      }
    })
    expect(typeof def.onEvent).toBe('function')
    // @ts-expect-error onEvent takes an event and the context
    definePlugin({ onEvent: (event: AsteraEvent, ctx: PluginContext, extra: number) => void [event, ctx, extra] })
    expect(seen).toEqual([])
  })
})
