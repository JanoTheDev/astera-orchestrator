import { describe, it, expect } from 'vitest'
import type { AsteraEvent, EventGap } from '@astera-app/client'
import {
  NOTIFICATION_KINDS,
  defineCompletionCheckProvider,
  defineJobSourceProvider,
  defineNotificationProvider,
  definePlugin,
  type AsteraNotification,
  type CompletionCheckDiagnostic,
  type CompletionCheckInput,
  type CompletionCheckResult,
  type JobSourceContext,
  type JobSourceItemDetail,
  type JobSourcePage,
  type JobSourceQuery,
  type PluginContext
} from './index.js'

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

  // Plugin Phase 4 J1: the job-source capability's provider
  it('defineJobSourceProvider hands back the provider, and a provider has all three functions', async () => {
    const p = defineJobSourceProvider({
      async listItems(input: JobSourceQuery, ctx: PluginContext): Promise<JobSourcePage> {
        void ctx
        return { items: [{ id: 'ENG-1', title: input.query ?? '', status: 'Todo' }], nextCursor: 'c2' }
      },
      getItem: (id: string): JobSourceItemDetail => ({ id, title: 't', body: 'b', fields: { team: 'ENG' } }),
      buildJobContext: (id: string): JobSourceContext => ({ objective: 'Fix', sourceLabel: `Linear ${id}`, evidence: [{ label: 'Description', content: 'b' }] })
    })
    expect((await p.listItems({ query: 'q' }, {} as PluginContext)).items[0].title).toBe('q')
    expect(p.getItem('ENG-1')).toMatchObject({ fields: { team: 'ENG' } })
    // @ts-expect-error a provider has getItem
    defineJobSourceProvider({ listItems: () => ({ items: [] }), buildJobContext: () => ({ objective: 'o', sourceLabel: 'l' }) })
    // @ts-expect-error an item needs a title
    defineJobSourceProvider({ listItems: () => ({ items: [{ id: 'x' }] }), getItem: (id: string) => ({ id, title: 't' }), buildJobContext: () => ({ objective: 'o', sourceLabel: 'l' }) })
    // @ts-expect-error a context needs a sourceLabel
    defineJobSourceProvider({ listItems: () => ({ items: [] }), getItem: (id: string) => ({ id, title: 't' }), buildJobContext: () => ({ objective: 'o' }) })
  })

  // Plugin Phase 5 C1: the completion-check capability's provider
  it('defineCompletionCheckProvider hands back the provider, and a provider is its runCheck', async () => {
    const p = defineCompletionCheckProvider({
      async runCheck(input: CompletionCheckInput, ctx: PluginContext): Promise<CompletionCheckResult> {
        void ctx
        const found: CompletionCheckDiagnostic[] = [{ file: 'src/a.js', line: 2, message: 'adds console.log', severity: 'error' }]
        return input.workspace.base === undefined
          ? { status: 'passed' }
          : { status: 'failed', summary: '1 leftover', diagnostics: found, externalUrl: 'https://ci.example/1' }
      }
    })
    const input: CompletionCheckInput = { jobId: 'j', runId: 'r', taskId: 't', task: { title: 'x' }, workspace: { root: '/w', base: 'abc' } }
    expect((await p.runCheck(input, {} as PluginContext)).status).toBe('failed')
    // @ts-expect-error a provider has runCheck
    defineCompletionCheckProvider({ activate() {} })
    // @ts-expect-error a status is passed, failed or error
    defineCompletionCheckProvider({ runCheck: () => ({ status: 'ok' }) })
    // @ts-expect-error a finding needs a message
    defineCompletionCheckProvider({ runCheck: () => ({ status: 'failed', diagnostics: [{ file: 'a.js' }] }) })
  })
})
