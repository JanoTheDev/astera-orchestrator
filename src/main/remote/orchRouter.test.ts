import { describe, it, expect } from 'vitest'
import { createOrchRouter, splitCursor, type OrchHandlers } from './orchRouter'
import type { RemoteRuntimeClient } from './runtimeClient'

/** Local handlers that record each call: what today's ipc.ts bodies are, with their guards inside. */
const recordingLocal = () => {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const local: OrchHandlers = {
    list: async (...args) => (calls.push({ name: 'list', args }), { runs: [], projectFolderBusy: false }),
    runDetail: async (...args) => (calls.push({ name: 'runDetail', args }), { events: [], layers: [], deps: {}, cyclic: [] }),
    completion: async (...args) => (calls.push({ name: 'completion', args }), null),
    command: async (...args) => (calls.push({ name: 'command', args }), { status: 200, body: { local: true } })
  }
  return { local, calls }
}

const fakeClient = (): RemoteRuntimeClient & { seen: string[] } => {
  const seen: string[] = []
  return {
    seen,
    runtimeId: 'rt_a',
    mirror: () => ({ state: null, version: 0, bootId: null, offline: false, stale: false, at: null }),
    refresh: async () => ({ state: null, version: 0, bootId: null, offline: false, stale: false, at: null }),
    list: async (p) => (seen.push(`list:${p}`), { runs: [], projectFolderBusy: false, runtime: { runtimeId: 'rt_a', offline: false, stale: false, version: 1 } }),
    runDetail: async (r) => (seen.push(`runDetail:${r}`), { events: [], layers: [], deps: {}, cyclic: [] }),
    completion: async (r, t) => (seen.push(`completion:${r}:${t}`), null),
    command: async (c) => (seen.push(`command:${c}`), { status: 200, body: { remote: true } }),
    projects: async () => [],
    status: () => ({ offline: false, lastSeenAt: null }),
    ping: async () => ({ ok: true, hello: null }),
    subscribePty: () => () => {},
    close: () => {}
  }
}

describe('createOrchRouter (remote runtime design §2.7, D1.1, D1.6, D1.7)', () => {
  it("sends a call with no runtime, or 'local', to the local handlers exactly as given", async () => {
    const l = recordingLocal()
    const client = fakeClient()
    const r = createOrchRouter({ local: l.local, remote: { client: async () => client } })
    await r.list('/p')
    await r.list('/p', 'local')
    await r.runDetail('/p', 'run_1', { journalPages: 2 })
    await r.completion('/p', 'run_1', 'tsk_1', 'local')
    expect(await r.command('/p', 'jobs-run', { id: 'j' })).toEqual({ status: 200, body: { local: true } })
    expect(l.calls.map((c) => c.name)).toEqual(['list', 'list', 'runDetail', 'completion', 'command'])
    expect(l.calls[0].args).toEqual(['/p'])
    expect(l.calls[2].args).toEqual(['/p', 'run_1', { journalPages: 2 }])
    expect(client.seen).toEqual([])
  })

  it('sends a remote call to its client only: no local handler, so no guard and no project registration', async () => {
    const l = recordingLocal()
    const client = fakeClient()
    const r = createOrchRouter({ local: l.local, remote: { client: async () => client } })
    expect(await r.list('/srv/repo', 'rt_a')).toMatchObject({ runtime: { runtimeId: 'rt_a' } })
    await r.runDetail('/srv/repo', 'run_1', undefined, 'rt_a')
    await r.completion('/srv/repo', 'run_1', 'tsk_1', 'rt_a')
    expect(await r.command('/srv/repo', 'jobs-run', { id: 'j' }, 'rt_a')).toEqual({ status: 200, body: { remote: true } })
    expect(client.seen).toEqual(['list:/srv/repo', 'runDetail:run_1', 'completion:run_1:tsk_1', 'command:jobs-run'])
    expect(l.calls).toEqual([])
  })

  it('a runtime nobody paired answers on its own, and the local handlers still answer', async () => {
    const l = recordingLocal()
    const r = createOrchRouter({ local: l.local, remote: { client: async () => ({ code: 'RUNTIME_NOT_FOUND', message: 'no such runtime' }) } })
    expect(await r.list('/p', 'rt_x')).toEqual({ runs: [], projectFolderBusy: false, runtime: { runtimeId: 'rt_x', offline: true, stale: false, version: 0 } })
    expect(await r.runDetail('/p', 'run_1', undefined, 'rt_x')).toEqual({ events: [], layers: [], deps: {}, cyclic: [] })
    expect(await r.completion('/p', 'run_1', 't', 'rt_x')).toBeNull()
    expect(await r.command('/p', 'jobs-run', {}, 'rt_x')).toEqual({ status: 404, body: { error: 'no such runtime', code: 'RUNTIME_NOT_FOUND' } })
    expect(l.calls).toEqual([])
    await r.list('/p')
    expect(l.calls.map((c) => c.name)).toEqual(['list'])
  })

  it('a remote client that throws does not reach the local handlers, and answers as offline', async () => {
    const l = recordingLocal()
    const broken = { ...fakeClient(), list: async () => { throw new Error('boom') }, command: async () => { throw new Error('boom') } }
    const r = createOrchRouter({ local: l.local, remote: { client: async () => broken } })
    expect(await r.list('/p', 'rt_a')).toMatchObject({ runs: [], runtime: { runtimeId: 'rt_a', offline: true } })
    expect(await r.command('/p', 'jobs-run', {}, 'rt_a')).toMatchObject({ status: 503, body: { code: 'RUNTIME_OFFLINE' } })
    expect(l.calls).toEqual([])
  })

  // Phase 5 review M-1: a runtimeId that is not a string names no Runtime.
  it('a runtimeId that is not a string is RUNTIME_NOT_FOUND, and asks no client', async () => {
    const l = recordingLocal()
    let asked = 0
    const r = createOrchRouter({ local: l.local, remote: { client: async () => (asked++, fakeClient()) } })
    expect(await r.command('/p', 'jobs-run', {}, 42 as never)).toMatchObject({ status: 404, body: { code: 'RUNTIME_NOT_FOUND' } })
    expect((await r.list('/p', {} as never)).runtime).toMatchObject({ runtimeId: '', offline: true })
    expect(asked).toBe(0)
    expect(l.calls).toEqual([])
  })

  // W6-A: the New plan dialog's commands need the Host's gh and profile
  it('W6-A: sends the intake commands to the local Host', async () => {
    const l = recordingLocal()
    const host: string[] = []
    const r = createOrchRouter({
      local: l.local,
      host: async (_p, c) => (host.push(c), { status: 200, body: { host: true } }),
      remote: { client: async () => fakeClient() }
    })
    for (const cmd of ['jobs-create', 'jobs-create-from-issue', 'github-issue-assign', 'sources-items'])
      expect(await r.command('/p', cmd, {}), cmd).toEqual({ status: 200, body: { host: true } })
    expect(host).toEqual(['jobs-create', 'jobs-create-from-issue', 'github-issue-assign', 'sources-items'])
    expect(l.calls).toEqual([])
  })

  it('W4: sends sessions-send for the local runtime to the Host, every other command to the local handlers', async () => {
    const l = recordingLocal()
    const host: Array<[string, string, Record<string, unknown>]> = []
    const r = createOrchRouter({
      local: l.local,
      host: async (p, c, args) => (host.push([p, c, args]), { status: 200, body: { host: true } }),
      remote: { client: async () => fakeClient() }
    })
    expect(await r.command('/p', 'sessions-send', { id: 's1', text: '4' })).toEqual({ status: 200, body: { host: true } })
    expect(await r.command('/p', 'jobs-run', { id: 'j' }, 'local')).toEqual({ status: 200, body: { local: true } })
    expect(host).toEqual([['/p', 'sessions-send', { id: 's1', text: '4' }]])
    expect(l.calls.map((c) => c.name)).toEqual(['command'])
    // A paired Runtime's send still goes to that Runtime, never to the local Host
    expect(await r.command('/p', 'sessions-send', { id: 's1', text: '4' }, 'rt_a')).toEqual({ status: 200, body: { remote: true } })
    expect(host).toHaveLength(1)
  })

  it('W8-F (#93): jobs-feedback goes to the Host, which owns the planner session, and a Runtime keeps its own', async () => {
    const l = recordingLocal()
    const host: string[] = []
    const r = createOrchRouter({
      local: l.local,
      host: async (_p, c) => (host.push(c), { status: 200, body: { via: 'typed' } }),
      remote: { client: async () => fakeClient() }
    })
    expect(await r.command('/p', 'jobs-feedback', { job: 'j', text: 'more' })).toEqual({ status: 200, body: { via: 'typed' } })
    expect(host).toEqual(['jobs-feedback'])
    expect(l.calls).toEqual([])
    await r.command('/p', 'jobs-feedback', { job: 'j', text: 'more' }, 'rt_a')
    expect(host).toHaveLength(1)
  })

  it('W5-D (#42): sessions-list goes to the Host too, which reads the hook events and their prompt', async () => {
    const l = recordingLocal()
    const host: unknown[] = []
    const r = createOrchRouter({
      local: l.local,
      host: async (...args) => (host.push(args), { status: 200, body: [] }),
      remote: { client: async () => fakeClient() }
    })
    expect(await r.command('/p', 'sessions-list', { status: 'waiting' })).toEqual({ status: 200, body: [] })
    expect(host).toEqual([['/p', 'sessions-list', { status: 'waiting' }]])
    expect(l.calls).toEqual([])
  })

  it('the tab summaries go to the Host, the only one that reads them (the sidebar\'s failed dot)', async () => {
    const l = recordingLocal()
    const host: string[] = []
    const r = createOrchRouter({
      local: l.local,
      host: async (_p, c) => (host.push(c), { status: 200, body: [] }),
      remote: { client: async () => fakeClient() }
    })
    expect(await r.command('/p', 'summaries', {})).toEqual({ status: 200, body: [] })
    expect(await r.command('/p', 'sessions-summary', { id: 's1' })).toEqual({ status: 200, body: [] })
    expect(host).toEqual(['summaries', 'sessions-summary'])
    expect(l.calls).toEqual([])
  })
})

describe('merged reads across Runtimes (W5-D, #44)', () => {
  const ev = (id: string, occurredAt: string) => ({ id, type: 'task.status', sequence: 1, occurredAt, payload: { title: id } })
  /** A Runtime answering each merged read with its own page; `seen` keeps the args it was asked with. */
  const runtime = (runtimeId: string, answers: Record<string, unknown>, status = 200) => {
    const seen: Array<{ cmd: string; args: Record<string, unknown> }> = []
    const c = { ...fakeClient(), runtimeId, command: async (cmd: string, args: Record<string, unknown>) => (seen.push({ cmd, args }), { status, body: answers[cmd] }) }
    return { c, seen }
  }
  const router = (local: Record<string, unknown>, rts: Array<ReturnType<typeof runtime>>, o: { mergedTimeoutMs?: number } = {}) => {
    const localSeen: Array<{ cmd: string; args: Record<string, unknown> }> = []
    const l = recordingLocal()
    const r = createOrchRouter({
      local: { ...l.local, command: async (_p, cmd, args) => (localSeen.push({ cmd, args }), { status: 200, body: local[cmd] }) },
      remote: {
        client: async (id) => rts.find((x) => x.c.runtimeId === id)?.c ?? { code: 'RUNTIME_NOT_FOUND', message: 'gone' },
        list: async () => rts.map((x) => ({ runtimeId: x.c.runtimeId }))
      },
      ...o
    })
    return { r, localSeen }
  }

  it('dispatches-list: the local Host and every Runtime, each remote Dispatch tagged with its runtime', async () => {
    const a = runtime('rt_a', { 'dispatches-list': [{ id: 'd2' }] })
    const { r } = router({ 'dispatches-list': [{ id: 'd1' }] }, [a])
    expect(await r.command('/p', 'dispatches-list', {})).toEqual({ status: 200, body: [{ id: 'd1' }, { id: 'd2', runtimeId: 'rt_a' }] })
    // 'local' or one Runtime's id still asks only that one
    expect(await r.command('/p', 'dispatches-list', {}, 'local')).toEqual({ status: 200, body: [{ id: 'd1' }] })
    expect(await r.command('/p', 'dispatches-list', {}, 'rt_a')).toEqual({ status: 200, body: [{ id: 'd2' }] })
  })

  it('with no Runtime paired, the local answer is the answer, its cursor untouched', async () => {
    const { r } = router({ 'activity-poll': { events: [ev('e1', 'T1')], cursor: 'c_local', gap: false } }, [])
    expect(await r.everywhere('activity-poll', { after: 'c0' }, async (args) => ({ status: 200, body: { args } }))).toEqual({
      status: 200,
      body: { args: { after: 'c0' } }
    })
  })

  it('activity-poll: lines in time order, each Host read on from its own cursor, a gap if any had one', async () => {
    const a = runtime('rt_a', { 'activity-poll': { events: [ev('e2', 'T2')], cursor: 'c_a1', gap: true } })
    const { r } = router({}, [a])
    const localArgs: unknown[] = []
    const local = async (args: Record<string, unknown>) => (
      localArgs.push(args), { status: 200, body: { events: [ev('e1', 'T1'), ev('e3', 'T3')], cursor: 'c_l1', gap: false } }
    )
    const first = await r.everywhere('activity-poll', { limit: 500 }, local)
    expect(first.body).toMatchObject({ events: [{ id: 'e1' }, { id: 'e2', runtimeId: 'rt_a' }, { id: 'e3' }], gap: true })
    const cursor = (first.body as { cursor: string }).cursor
    expect(splitCursor(cursor)).toEqual({ local: 'c_l1', rt_a: 'c_a1' })
    await r.everywhere('activity-poll', { limit: 500, after: cursor }, local)
    expect(localArgs[1]).toEqual({ limit: 500, after: 'c_l1' })
    expect(a.seen[1].args).toEqual({ limit: 500, after: 'c_a1' })
    // A plain cursor (from before any Runtime was paired) is the local Host's
    expect(splitCursor('c_old')).toEqual({ local: 'c_old' })
    // And a merged one, once the last Runtime is gone, gives the local Host only its own
    const { r: alone } = router({}, [])
    await alone.everywhere('activity-poll', { limit: 500, after: cursor }, local)
    expect(localArgs[2]).toEqual({ limit: 500, after: 'c_l1' })
  })

  it('a Runtime that fails or never answers is left out, its cursor kept; a local failure is the answer', async () => {
    const down = runtime('rt_down', {}, 503)
    const slow = { c: { ...fakeClient(), runtimeId: 'rt_slow', command: () => new Promise<never>(() => {}) }, seen: [] }
    const { r } = router({}, [down, slow], { mergedTimeoutMs: 20 })
    const ok = async () => ({ status: 200, body: { events: [ev('e1', 'T1')], cursor: 'c_l2', gap: false } })
    const page = await r.everywhere('activity-poll', { after: JSON.stringify({ local: 'c_l1', rt_down: 'c_d', rt_slow: 'c_s' }) }, ok)
    expect(page.status).toBe(200)
    expect(splitCursor((page.body as { cursor: string }).cursor)).toEqual({ local: 'c_l2', rt_down: 'c_d', rt_slow: 'c_s' })
    expect(await r.everywhere('activity-poll', {}, async () => ({ status: 501, body: { error: 'old Host' } }))).toEqual({ status: 501, body: { error: 'old Host' } })
  })

  it('activity-summary: every bucket from every Host, remote items tagged', async () => {
    const empty = { completed: [], failed: [], cancelled: [], awaitingReview: [], plansDone: [], blocked: [] }
    const a = runtime('rt_a', { 'activity-summary': { ...empty, since: 'S', failed: [{ title: 'remote f' }] } })
    const { r } = router({}, [a])
    const page = await r.everywhere('activity-summary', { since: 'S' }, async () => ({ status: 200, body: { ...empty, since: 'S', failed: [{ title: 'local f' }] } }))
    expect(page.body).toEqual({ ...empty, since: 'S', failed: [{ title: 'local f' }, { title: 'remote f', runtimeId: 'rt_a' }] })
  })
})

describe('projects-add on a Runtime (T12b)', () => {
  const routerWith = (permission: string) => {
    const l = recordingLocal()
    const client = fakeClient()
    const r = createOrchRouter({ local: l.local, remote: { client: async () => client, list: async () => [{ runtimeId: 'rt_a', permission }] } })
    return { r, l, client }
  }

  it('sends projects-add --clone to a full-control Runtime, and never to the local Host', async () => {
    const { r, l, client } = routerWith('full-control')
    expect(await r.command('/p', 'projects-add', { clone: 'https://github.com/o/r.git' }, 'rt_a')).toEqual({ status: 200, body: { remote: true } })
    expect(client.seen).toEqual(['command:projects-add'])
    expect(l.calls).toEqual([])
  })

  it('refuses it for a read-only pairing before anything is sent', async () => {
    const { r, l, client } = routerWith('read-only')
    const reply = await r.command('/p', 'projects-add', { clone: 'https://github.com/o/r.git' }, 'rt_a')
    expect(reply.status).toBe(403)
    expect(reply.body).toMatchObject({ code: 'RUNTIME_PERMISSION_DENIED' })
    expect(client.seen).toEqual([])
    expect(l.calls).toEqual([])
  })

  it('refuses it for a Runtime it cannot find in the paired list', async () => {
    const { r, client } = routerWith('full-control')
    expect((await r.command('/p', 'projects-add', { clone: 'https://x/y.git' }, 'rt_other')).status).toBe(403)
    expect(client.seen).toEqual([])
  })
})
