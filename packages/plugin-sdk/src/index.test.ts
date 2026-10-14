import { describe, it, expect } from 'vitest'
import type { AsteraEvent, EventGap } from '@astera-app/client'
import { NOTIFICATION_KINDS, defineNotificationProvider, definePlugin, type AsteraNotification, type PluginContext } from './index.js'

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
    // Final review M8: a handler that leaves out the gap would throw on it and hold every later event for an hour
    // @ts-expect-error onEvent is handed a gap too
    definePlugin({ onEvent: (event: AsteraEvent, ctx: PluginContext) => void [event.id, ctx] })
    // @ts-expect-error the same, written as a method
    definePlugin({ onEvent(event: AsteraEvent, ctx: PluginContext) { void [event.id, ctx] } })
    expect(seen).toEqual([])
  })

  // Plugin Phase 3 N5, N10, N11: the notification capability's provider
  it('defineNotificationProvider hands back the provider, and a provider must have send', () => {
    const sent: string[] = []
    const p = defineNotificationProvider({
      send(n: AsteraNotification, ctx: PluginContext) {
        // A kind this provider does not know is posted by its title and body too
        sent.push(`${n.kind} ${n.level} ${n.title}: ${n.body}`)
        void ctx
      }
    })
    expect(typeof p.send).toBe('function')
    // @ts-expect-error a provider is its send
    defineNotificationProvider({ activate() {} })
    expect(NOTIFICATION_KINDS).toContain('session.input_needed')
    expect(sent).toEqual([])
    // 3c final review M6: a kind and a level a later Astera adds are strings a provider posts as it can
    const later: AsteraNotification = { id: 'x', kind: 'later.kind', level: 'notice', title: 't', body: 'b', occurredAt: 'T', event: {} as AsteraNotification['event'] }
    expect(later.level).toBe('notice')
  })
})
