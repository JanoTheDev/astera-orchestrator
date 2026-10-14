// The plugin launcher in process: the JSON-RPC it speaks with the Host on its stdio, the context it builds and the
// plugin's lifecycle (plugin runtime design P9, P10). launcher.subprocess.test.ts runs the bundled launcher for real.
import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { runLauncher } from './launcher'
import { AsteraError } from '../core/publicContract'
import { RPC_NOT_READY } from '../core/plugins/rpc'
import type { PluginContext } from '../../packages/plugin-sdk/src/index'

const INIT_PARAMS = {
  apiVersion: '1',
  plugin: { id: 'astera-hello', version: '1.0.0', dir: '/plugins/astera-hello', entry: '/plugins/astera-hello/index.js', permissions: ['projects.read'] },
  host: { version: '9.9.9', pid: 4242, startedAt: '2026-10-13T00:00:00.000Z', features: ['orch', 'requests'] }
}

/** A launcher whose entry module is `mod`, with the Host's side of its stdio in the test's hands. */
function launch(mod: unknown | (() => Promise<unknown>), extra: { endGraceMs?: number } = {}) {
  const input = new PassThrough()
  const out: Record<string, unknown>[] = []
  const logs: string[] = []
  const exits: number[] = []
  const imported: string[] = []
  runLauncher({
    input,
    output: (line) => out.push(JSON.parse(line) as Record<string, unknown>),
    log: (line) => logs.push(line),
    importEntry: async (file) => {
      imported.push(file)
      return typeof mod === 'function' ? (mod as () => Promise<unknown>)() : mod
    },
    exit: (code) => exits.push(code),
    ...extra
  })
  let id = 100
  const send = (m: Record<string, unknown>): void => void input.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const ask = async (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const mine = ++id
    send({ id: mine, method, params })
    return vi.waitFor(() => {
      const a = out.find((m) => m.id === mine && !('method' in m))
      if (!a) throw new Error(`no answer to ${method}`)
      return a
    })
  }
  /** The next call the plugin made, answered with `answer`. */
  const answerCall = async (answer: { status: number; body: unknown }): Promise<Record<string, unknown>> => {
    const call = await vi.waitFor(() => {
      const c = out.find((m) => m.method === 'call' && !(m as { answered?: boolean }).answered)
      if (!c) throw new Error('no call yet')
      return c
    })
    ;(call as { answered?: boolean }).answered = true
    send({ id: call.id, result: answer })
    return call
  }
  return { input, out, logs, exits, imported, send, ask, answerCall }
}

describe('runLauncher', () => {
  it('loads the entry, gives activate the plugin’s context, and answers initialize once activate resolved', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    expect(await l.ask('initialize', INIT_PARAMS)).toEqual({ jsonrpc: '2.0', id: 101, result: { handlers: [] } })
    expect(l.imported).toEqual(['/plugins/astera-hello/index.js'])
    expect(ctx?.plugin).toEqual({ id: 'astera-hello', version: '1.0.0', dir: '/plugins/astera-hello' })
    expect(ctx?.permissions).toEqual(['projects.read'])
    expect(ctx?.signal.aborted).toBe(false)
    expect(ctx?.astera.host).toEqual({ version: '9.9.9', pid: 4242, startedAt: '2026-10-13T00:00:00.000Z', features: ['orch', 'requests'] })
    ctx?.log.info('hello')
    ctx?.log.warn('careful')
    ctx?.log.error('broken')
    expect(l.logs).toEqual(['[info] hello', '[warn] careful', '[error] broken'])
  })

  it('sends ctx.astera’s calls to the Host as call requests and hands back the answers', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    await l.ask('initialize', INIT_PARAMS)
    const listed = ctx!.astera.projects.list()
    const call = await l.answerCall({ status: 200, body: [{ id: 'proj_1', path: '/p', name: 'p', addedAt: 'T' }] })
    expect(call).toMatchObject({ method: 'call', params: { cmd: 'projects-list', args: {} } })
    expect(await listed).toEqual({ items: [{ id: 'proj_1', path: '/p', name: 'p', addedAt: 'T' }] })
    const refused = ctx!.astera.call('jobs-create', { objective: 'x' }, { requestId: 'r-1' }).catch((e: unknown) => e)
    expect(await l.answerCall({ status: 403, body: { error: 'jobs-create needs the jobs.create permission' } })).toMatchObject({
      params: { cmd: 'jobs-create', args: { objective: 'x' }, request: 'r-1' }
    })
    const e = await refused
    expect(e).toBeInstanceOf(AsteraError)
    expect(e).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('answers an activate that throws with its message, and logs it', async () => {
    const l = launch({ default: { activate: () => Promise.reject(new Error('no token configured')) } })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ error: { code: -32603, message: 'activate threw: no token configured' } })
    expect(l.logs.join('\n')).toContain('no token configured')
  })

  it('refuses an entry that exports no plugin', async () => {
    for (const mod of [{ default: 3 }, { default: { activate: 'not a function' } }, { default: { deactivate: 1 } }]) {
      const l = launch(mod)
      expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({
        error: { message: 'the entry does not export a plugin: export default definePlugin({ ... })' }
      })
    }
  })

  it('answers an entry that cannot be loaded with why', async () => {
    const l = launch(() => Promise.reject(new Error('Cannot find module left-pad')))
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ error: { message: 'the entry could not be loaded: Cannot find module left-pad' } })
  })

  it('takes the plugin from CommonJS compiled out of ESM, one default deeper', async () => {
    const activate = vi.fn()
    const l = launch({ default: { default: { activate } } })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ result: {} })
    expect(activate).toHaveBeenCalledOnce()
  })

  it('refuses initialize without what it needs, and a second one', async () => {
    const l = launch({ default: {} })
    expect(await l.ask('initialize', { apiVersion: '1' })).toMatchObject({ error: { code: -32602 } })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ result: {} })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ error: { message: 'the plugin is already started' } })
  })

  it('on shutdown aborts the signal, runs deactivate, answers, and exits 0', async () => {
    let ctx: PluginContext | undefined
    const deactivate = vi.fn()
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c), deactivate } })
    await l.ask('initialize', INIT_PARAMS)
    expect(await l.ask('shutdown', {})).toMatchObject({ result: {} })
    expect(ctx?.signal.aborted).toBe(true)
    expect(deactivate).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(l.exits).toEqual([0]))
  })

  it('when the Host closes the channel, fails calls in flight, runs deactivate and exits 0', async () => {
    let ctx: PluginContext | undefined
    const deactivate = vi.fn()
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c), deactivate } })
    await l.ask('initialize', INIT_PARAMS)
    const pending = ctx!.astera.call('projects-list').catch((e: unknown) => e)
    await vi.waitFor(() => expect(l.out.some((m) => m.method === 'call')).toBe(true))
    l.input.end()
    expect(await pending).toMatchObject({ code: 'HOST_NOT_RUNNING' })
    await vi.waitFor(() => expect(l.exits).toEqual([0]))
    expect(deactivate).toHaveBeenCalledOnce()
    expect(ctx?.signal.aborted).toBe(true)
  })

  // 2b final review I3: with the Host gone a plugin must not outlive it, whatever its deactivate does.
  it('when the Host has closed the channel, a call made in deactivate fails at once', async () => {
    let ctx: PluginContext | undefined
    let caught: unknown
    const l = launch({
      default: {
        activate: (c: PluginContext) => void (ctx = c),
        deactivate: async () => {
          const started = Date.now()
          await ctx!.astera.projects.list().catch((e: unknown) => (caught = e))
          ;(caught as { took?: number }).took = Date.now() - started
        }
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    l.input.end()
    await vi.waitFor(() => expect(l.exits).toEqual([0]))
    expect(caught).toMatchObject({ code: 'HOST_NOT_RUNNING' })
    expect((caught as { took: number }).took).toBeLessThan(1000)
  })

  it('when the Host has closed the channel, exits after the grace even if deactivate never ends', async () => {
    const l = launch({ default: { activate() {}, deactivate: () => new Promise(() => {}) } }, { endGraceMs: 50 })
    await l.ask('initialize', INIT_PARAMS)
    l.input.end()
    await vi.waitFor(() => expect(l.exits).toEqual([0]))
    expect(l.logs.join('\n')).toContain('[launcher] deactivate did not finish within 0.05 s of the Host leaving')
  })

  it('answers an unknown method with -32601', async () => {
    const l = launch({ default: {} })
    expect(await l.ask('reticulate', {})).toMatchObject({ error: { code: -32601 } })
  })
})

// Plugins 2c: the settings a person set, and secrets the plugin keeps (spec §23-§24).
describe('runLauncher: settings and secrets', () => {
  const withSettings = { ...INIT_PARAMS, plugin: { ...INIT_PARAMS.plugin, settings: { baseUrl: 'https://jira.example.com', pageSize: 50, token: 'tok-1' } } }

  it('hands activate the settings it was started with, frozen', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    await l.ask('initialize', withSettings)
    expect(ctx?.settings).toEqual({ baseUrl: 'https://jira.example.com', pageSize: 50, token: 'tok-1' })
    expect(Object.isFrozen(ctx?.settings)).toBe(true)
  })

  it('hands an empty settings object to a plugin started with none', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    await l.ask('initialize', INIT_PARAMS)
    expect(ctx?.settings).toEqual({})
  })

  it('asks the Host for its secrets, and keeps them there', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    await l.ask('initialize', INIT_PARAMS)
    const answer = async (method: string, result: unknown): Promise<Record<string, unknown>> => {
      const req = await vi.waitFor(() => {
        const r = l.out.find((m) => m.method === method && !(m as { answered?: boolean }).answered)
        if (!r) throw new Error(`no ${method}`)
        return r
      })
      ;(req as { answered?: boolean }).answered = true
      l.send({ id: req.id, result })
      return req
    }
    const got = ctx!.secrets.get('refresh-token')
    expect(await answer('secrets.get', { value: 'r-1' })).toMatchObject({ params: { name: 'refresh-token' } })
    expect(await got).toBe('r-1')
    const none = ctx!.secrets.get('other')
    await answer('secrets.get', { value: null })
    expect(await none).toBeUndefined()
    const set = ctx!.secrets.set('refresh-token', 'r-2')
    expect(await answer('secrets.set', {})).toMatchObject({ params: { name: 'refresh-token', value: 'r-2' } })
    await set
    const del = ctx!.secrets.delete('refresh-token')
    expect(await answer('secrets.delete', {})).toMatchObject({ params: { name: 'refresh-token' } })
    await del
  })

  it('rejects with what the Host said when it refuses a secret', async () => {
    let ctx: PluginContext | undefined
    const l = launch({ default: { activate: (c: PluginContext) => void (ctx = c) } })
    await l.ask('initialize', INIT_PARAMS)
    const refused = ctx!.secrets.set('../x', 'v').catch((e: unknown) => e)
    const req = await vi.waitFor(() => {
      const r = l.out.find((m) => m.method === 'secrets.set')
      if (!r) throw new Error('no secrets.set')
      return r
    })
    l.send({ id: req.id, error: { code: -32602, message: '../x is not a secret name' } })
    expect(await refused).toMatchObject({ message: '../x is not a secret name' })
  })

  // Plugin Phase 3 N5: the Host fails the start of a plugin whose capability has no handler, so it asks which it has
  it('says which handlers the entry has when it starts', async () => {
    const l = launch({ default: { onEvent() {}, activate() {} } })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ result: { handlers: ['onEvent'] } })
    const none = launch({ default: { activate() {} } })
    expect(await none.ask('initialize', INIT_PARAMS)).toMatchObject({ result: { handlers: [] } })
    // One default deeper, as CommonJS compiled out of ESM has it, when the outer object holds only a handler's default
    const cjs = launch({ default: { default: { onEvent() {} } } })
    expect(await cjs.ask('initialize', INIT_PARAMS)).toMatchObject({ result: { handlers: ['onEvent'] } })
  })

  it('hands an event to onEvent with the plugin’s context, and answers once it settled', async () => {
    const seen: unknown[] = []
    let ctxSeen: PluginContext | undefined
    let release: () => void = () => {}
    const l = launch({
      default: {
        async onEvent(e: unknown, ctx: PluginContext) {
          seen.push(e)
          ctxSeen = ctx
          await new Promise<void>((r) => (release = r))
        }
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    const event = { id: 'ev_aaaaaaaaaaaa_1', type: 'run.completed', sequence: 1, occurredAt: 'T', payload: {} }
    const answered = l.ask('events.deliver', { event })
    await vi.waitFor(() => expect(seen).toEqual([event]))
    // Not answered while onEvent has not settled (the initialize was 101, this is 102)
    expect(l.out.some((m) => m.id === 102)).toBe(false)
    release()
    expect(await answered).toMatchObject({ result: {} })
    expect(ctxSeen?.plugin.id).toBe('astera-hello')
  })

  it('answers a throwing onEvent with its message, and an entry without one with an error', async () => {
    const l = launch({
      default: {
        onEvent() {
          throw new Error('boom')
        }
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    expect(await l.ask('events.deliver', { event: { type: 'gap' } })).toMatchObject({ error: { code: -32603, message: 'onEvent threw: boom' } })
    const none = launch({ default: {} })
    await none.ask('initialize', INIT_PARAMS)
    expect(await none.ask('events.deliver', { event: { type: 'gap' } })).toMatchObject({ error: { code: -32601, message: 'the plugin has no onEvent' } })
    expect(await l.ask('events.deliver', {})).toMatchObject({ error: { code: -32602, message: 'events.deliver needs { event }' } })
  })

  it('refuses an onEvent that is not a function as no plugin, and an event before the start', async () => {
    const bad = launch({ default: { onEvent: 'x' } })
    expect(await bad.ask('initialize', INIT_PARAMS)).toMatchObject({ error: { message: expect.stringContaining('does not export a plugin') } })
    const early = launch({ default: { onEvent() {} } })
    expect(await early.ask('events.deliver', { event: { type: 'gap' } })).toMatchObject({ error: { message: 'the plugin is not started' } })
  })

  it('refuses an event once the plugin is stopping', async () => {
    const seen: unknown[] = []
    const l = launch({ default: { onEvent: (e: unknown) => void seen.push(e) } })
    await l.ask('initialize', INIT_PARAMS)
    await l.ask('shutdown', {})
    expect(await l.ask('events.deliver', { event: { type: 'gap' } })).toMatchObject({ error: { message: 'the plugin is stopping' } })
    expect(seen).toEqual([])
  })

  // Plugin Phase 3 N5: the notification capability's handler
  it('says a provider has send, and hands it a notification with the context, answering once it settled', async () => {
    const sent: unknown[] = []
    let ctxSeen: PluginContext | undefined
    let release: () => void = () => {}
    const l = launch({
      default: {
        async send(n: unknown, ctx: PluginContext) {
          sent.push(n)
          ctxSeen = ctx
          await new Promise<void>((r) => (release = r))
        }
      }
    })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ result: { handlers: ['send'] } })
    const notification = { id: 'ev_aaaaaaaaaaaa_1', kind: 'run.completed', level: 'info', title: 'Ship', body: 'Run 1 finished.', occurredAt: 'T', event: {} }
    const answered = l.ask('notifications.send', { notification })
    await vi.waitFor(() => expect(sent).toEqual([notification]))
    // Not answered while send has not settled (the initialize was 101, this is 102)
    expect(l.out.some((m) => m.id === 102)).toBe(false)
    release()
    expect(await answered).toMatchObject({ result: {} })
    expect(ctxSeen?.plugin.id).toBe('astera-hello')
  })

  it('answers a throwing send with its message, an entry without one, and a request without a notification', async () => {
    const l = launch({
      default: {
        send() {
          throw new Error('rate limited')
        }
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    expect(await l.ask('notifications.send', { notification: { kind: 'run.completed' } })).toMatchObject({ error: { code: -32603, message: 'send threw: rate limited' } })
    expect(await l.ask('notifications.send', {})).toMatchObject({ error: { code: -32602, message: 'notifications.send needs { notification }' } })
    const none = launch({ default: { onEvent() {} } })
    await none.ask('initialize', INIT_PARAMS)
    expect(await none.ask('notifications.send', { notification: {} })).toMatchObject({ error: { code: -32601, message: 'the plugin has no send' } })
    const early = launch({ default: { send() {} } })
    expect(await early.ask('notifications.send', { notification: {} })).toMatchObject({ error: { message: 'the plugin is not started' } })
  })

  // Plugin Phase 4 J6: a job source answers the Host with what its functions return
  it('says a job source has its three functions, and answers each request with what it returned', async () => {
    const seen: unknown[][] = []
    const l = launch({
      default: {
        listItems(input: unknown, ctx: PluginContext) {
          seen.push(['list', input, ctx.plugin.id])
          return { items: [{ id: 'ENG-1', title: 'Fix' }], nextCursor: 'c2' }
        },
        async getItem(id: unknown) {
          seen.push(['get', id])
          return { id, title: 'Fix', body: 'b' }
        },
        buildJobContext(id: unknown) {
          seen.push(['context', id])
          return { objective: 'Fix', sourceLabel: `Linear ${String(id)}` }
        }
      }
    })
    expect(await l.ask('initialize', INIT_PARAMS)).toMatchObject({ result: { handlers: ['listItems', 'getItem', 'buildJobContext'] } })
    expect(await l.ask('jobSource.list', { query: 'login', cursor: 'c1', extra: 1 })).toMatchObject({ result: { items: [{ id: 'ENG-1', title: 'Fix' }], nextCursor: 'c2' } })
    expect(await l.ask('jobSource.get', { id: 'ENG-1' })).toMatchObject({ result: { id: 'ENG-1', body: 'b' } })
    expect(await l.ask('jobSource.context', { id: 'ENG-1' })).toMatchObject({ result: { objective: 'Fix', sourceLabel: 'Linear ENG-1' } })
    expect(seen).toEqual([['list', { query: 'login', cursor: 'c1' }, 'astera-hello'], ['get', 'ENG-1'], ['context', 'ENG-1']])
  })

  it('answers a job source’s throw with its message, a missing function, and a request without an id', async () => {
    const l = launch({
      default: {
        listItems() {
          throw new Error('401 Unauthorized')
        }
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    expect(await l.ask('jobSource.list', {})).toMatchObject({ error: { code: -32603, message: 'listItems threw: 401 Unauthorized' } })
    expect(await l.ask('jobSource.get', { id: 'x' })).toMatchObject({ error: { code: -32601, message: 'the plugin has no getItem' } })
    expect(await l.ask('jobSource.context', {})).toMatchObject({ error: { code: -32602, message: 'jobSource.context needs { id }' } })
  })

  // The 4a review's I3: an answer JSON cannot hold is refused with why, and the launcher answers on
  it('answers a job source whose answer cannot be sent with why, and goes on answering', async () => {
    const circular: Record<string, unknown> = { id: 'c', title: 't' }
    circular.self = circular
    const l = launch({
      default: {
        listItems: () => ({ items: [{ id: 'ENG-1', title: 'Fix', size: BigInt(1) }] }),
        getItem: () => circular,
        buildJobContext: () => ({ objective: 'Fix', sourceLabel: 'L' })
      }
    })
    await l.ask('initialize', INIT_PARAMS)
    expect(await l.ask('jobSource.list', {})).toMatchObject({
      error: { code: -32603, message: expect.stringMatching(/^listItems answered with something that cannot be sent: .*BigInt/) }
    })
    expect(await l.ask('jobSource.get', { id: 'c' })).toMatchObject({
      error: { code: -32603, message: expect.stringMatching(/^getItem answered with something that cannot be sent: /) }
    })
    expect(await l.ask('jobSource.context', { id: 'ENG-1' })).toMatchObject({ result: { objective: 'Fix' } })
  })

  // The 4a review's M8: not started yet, or stopping, is said with a code of its own, which the Host answers as 503
  it('answers a job source request before the start, and while stopping, with the not-ready code', async () => {
    const early = launch({ default: { listItems: () => ({ items: [] }) } })
    expect(await early.ask('jobSource.list', {})).toMatchObject({ error: { code: RPC_NOT_READY, message: 'the plugin is not started' } })
    const l = launch({ default: { listItems: () => ({ items: [] }) } })
    await l.ask('initialize', INIT_PARAMS)
    await l.ask('shutdown', {})
    expect(await l.ask('jobSource.list', {})).toMatchObject({ error: { code: RPC_NOT_READY, message: 'the plugin is stopping' } })
  })
})
