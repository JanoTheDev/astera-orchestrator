// createAsteraClientOver: the client over a connection its caller gives (plugin runtime design P10), which the plugin
// launcher builds on its stdio. The same calls, answers and errors as over the Host's pipe.
import { describe, it, expect } from 'vitest'
import { createAsteraClientOver } from './client.js'
import { AsteraError } from './errors.js'
import type { ConnectionClientMessage, ConnectionHostMessage, HostConnection } from './connect.js'
import { HOST_FEATURE_ORCH, HOST_FEATURE_REQUESTS } from './protocol.js'

/** A connection that answers each orch-call with `answer(cmd, args)`, or holds it while `answer` returns null. */
function fakeConnection(o: { features?: string[]; answer?: (cmd: string, args: Record<string, unknown>) => { status: number; body: unknown } | null } = {}) {
  const sent: ConnectionClientMessage[] = []
  const listeners = new Set<(m: ConnectionHostMessage) => void>()
  const closers = new Set<() => void>()
  let closed = false
  const conn: HostConnection = {
    hello: { host: '9.9.9', pid: 4242, startedAt: '2026-10-13T00:00:00.000Z', features: o.features ?? [HOST_FEATURE_ORCH, HOST_FEATURE_REQUESTS] },
    call(m) {
      sent.push(m)
      if (m.t !== 'orch-call') return
      const a = (o.answer ?? (() => ({ status: 200, body: [] })))(m.cmd, m.args)
      if (a) queueMicrotask(() => listeners.forEach((l) => l({ t: 'orch-result', call: m.call, status: a.status, body: a.body })))
    },
    onMessage(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onClose(cb) {
      closers.add(cb)
      return () => closers.delete(cb)
    },
    ref() {},
    unref() {},
    close() {
      closed = true
      closers.forEach((c) => c())
    }
  }
  return { conn, sent, drop: () => closers.forEach((c) => c()), isClosed: () => closed }
}

const over = (f: ReturnType<typeof fakeConnection>) =>
  createAsteraClientOver({ connect: async () => f.conn, address: 'plugin channel', profileDir: '/profile' })

describe('createAsteraClientOver', () => {
  it('sends orch-call with the request id and answers the shaped body', async () => {
    const f = fakeConnection({ answer: () => ({ status: 200, body: [{ id: 'proj_1', path: '/p', name: 'p', addedAt: 'T', internal: 'x' }] }) })
    const c = await over(f)
    const r = await c.call('projects-list', {}, { requestId: 'req-1' })
    expect(f.sent[0]).toMatchObject({ t: 'orch-call', cmd: 'projects-list', args: {}, request: 'req-1' })
    expect(r.body).toEqual([{ id: 'proj_1', path: '/p', name: 'p', addedAt: 'T' }])
    expect(c.host).toEqual({ version: '9.9.9', pid: 4242, startedAt: '2026-10-13T00:00:00.000Z', features: [HOST_FEATURE_ORCH, HOST_FEATURE_REQUESTS] })
    expect(c.address).toBe('plugin channel')
    c.close()
  })

  it('serves the namespaces', async () => {
    const f = fakeConnection({ answer: (cmd) => (cmd === 'projects-list' ? { status: 200, body: [] } : null) })
    const c = await over(f)
    expect(await c.projects.list()).toMatchObject({ items: [] })
    c.close()
  })

  it('rejects a refusal with the code the CLI would give it', async () => {
    const f = fakeConnection({ answer: () => ({ status: 403, body: { error: 'jobs-create needs the jobs.create permission' } }) })
    const c = await over(f)
    const e = await c.call('jobs-create', { objective: 'x' }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AsteraError)
    expect(e).toMatchObject({ code: 'PERMISSION_DENIED', message: expect.stringContaining('jobs.create') })
    c.close()
  })

  it('fails a call in flight when the connection ends', async () => {
    const f = fakeConnection({ answer: () => null })
    const c = await over(f)
    const pending = c.call('projects-list').catch((x: unknown) => x)
    await new Promise((r) => setTimeout(r, 10))
    f.drop()
    expect(await pending).toMatchObject({ code: 'HOST_NOT_RUNNING', message: expect.stringContaining('plugin channel') })
    c.close()
  })

  it('closes the connection on close()', async () => {
    const f = fakeConnection()
    const c = await over(f)
    c.close()
    expect(f.isClosed()).toBe(true)
  })

  it('refuses every call on a connection whose Host runs no commands', async () => {
    const f = fakeConnection({ features: [] })
    const c = await over(f)
    expect(await c.call('projects-list').catch((x: unknown) => x)).toMatchObject({ code: 'VERSION_MISMATCH' })
    c.close()
  })
})

describe('the published package', () => {
  it('does not export the client over a given connection: it is the launcher’s, through internal.ts', async () => {
    const pub = await import('./index.js')
    expect('createAsteraClientOver' in pub).toBe(false)
    const internal = await import('./internal.js')
    expect(typeof internal.createAsteraClientOver).toBe('function')
  })
})
