import { describe, it, expect, vi } from 'vitest'
import { RpcError, createRpcPeer } from './rpc'

/** Two peers wired back to back, each line handed over on the next tick like a pipe would. */
function pair(handlers: { a?: Parameters<typeof createRpcPeer>[0]['onRequest']; b?: Parameters<typeof createRpcPeer>[0]['onRequest'] } = {}) {
  const lines: string[] = []
  let a: ReturnType<typeof createRpcPeer>
  let b: ReturnType<typeof createRpcPeer>
  a = createRpcPeer({ send: (l) => (lines.push(`a>${l}`), setImmediate(() => b.feed(l))), onRequest: handlers.a ?? (async () => ({})) })
  b = createRpcPeer({ send: (l) => (lines.push(`b>${l}`), setImmediate(() => a.feed(l))), onRequest: handlers.b ?? (async () => ({})) })
  return { a, b, lines }
}

describe('createRpcPeer (plugin runtime design P9)', () => {
  it('sends a JSON-RPC 2.0 request, one per line, and resolves its result', async () => {
    const { a, lines } = pair({ b: async (method, params) => ({ method, params }) })
    expect(await a.request('call', { cmd: 'projects-list' })).toEqual({ method: 'call', params: { cmd: 'projects-list' } })
    expect(JSON.parse(lines[0].slice(2))).toEqual({ jsonrpc: '2.0', id: 1, method: 'call', params: { cmd: 'projects-list' } })
    expect(lines[0].endsWith('\n')).toBe(true)
    expect(JSON.parse(lines[1].slice(2))).toEqual({ jsonrpc: '2.0', id: 1, result: { method: 'call', params: { cmd: 'projects-list' } } })
  })

  it('answers several requests in flight by their ids', async () => {
    const { a } = pair({ b: async (_m, params) => new Promise((r) => setTimeout(() => r(params), (params as { wait: number }).wait)) })
    expect(await Promise.all([a.request('x', { wait: 30 }), a.request('x', { wait: 1 })])).toEqual([{ wait: 30 }, { wait: 1 }])
  })

  it('rejects with the error the other side answered', async () => {
    const { a } = pair({
      b: async (method) => {
        if (method === 'nope') throw new RpcError(-32601, 'no method nope')
        throw new Error('it broke')
      }
    })
    await expect(a.request('nope', {})).rejects.toMatchObject({ code: -32601, message: 'no method nope' })
    await expect(a.request('other', {})).rejects.toMatchObject({ code: -32603, message: 'it broke' })
    expect(await a.request('nope', {}).catch((e: unknown) => e)).toBeInstanceOf(RpcError)
  })

  // The 4a review's I3: a result JSON cannot hold is answered as an error, not left to hang or to end the process
  it('answers a result that cannot be sent with an error saying so', async () => {
    const { a } = pair({ b: async () => ({ n: BigInt(1) }) })
    await expect(a.request('x', {})).rejects.toMatchObject({ code: -32603, message: expect.stringMatching(/^the answer could not be sent: .*BigInt/) })
  })

  it('reads a chunk that splits a line, and a chunk that holds two', async () => {
    const got: unknown[] = []
    const sent: string[] = []
    const peer = createRpcPeer({ send: (l) => sent.push(l), onRequest: async (_m, params) => (got.push(params), {}) })
    const one = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'm', params: { n: 1 } })
    const two = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'm', params: { n: 2 } })
    peer.feed(one.slice(0, 10))
    peer.feed(`${one.slice(10)}\n${two}\n`)
    await new Promise((r) => setImmediate(r))
    expect(got).toEqual([{ n: 1 }, { n: 2 }])
    expect(sent.map((l) => JSON.parse(l).id)).toEqual([1, 2])
  })

  it('reports a line that is not JSON-RPC and keeps reading', async () => {
    const bad: string[] = []
    const got: unknown[] = []
    const peer = createRpcPeer({ send: () => {}, onRequest: async (_m, p) => (got.push(p), {}), onBadMessage: (m) => bad.push(m) })
    peer.feed('not json\n{"jsonrpc":"1.0"}\n{"jsonrpc":"2.0","id":3,"method":"m","params":1}\n')
    await new Promise((r) => setImmediate(r))
    expect(bad).toHaveLength(2)
    expect(got).toEqual([1])
  })

  it('fails what is in flight when the channel closes, and every later request', async () => {
    const peer = createRpcPeer({ send: () => {}, onRequest: async () => ({}) })
    const pending = peer.request('m', {})
    peer.close('the plugin exited')
    await expect(pending).rejects.toMatchObject({ code: -32000, message: 'the plugin exited' })
    await expect(peer.request('m', {})).rejects.toMatchObject({ message: 'the plugin exited' })
  })
})

// 2b final review I2: what a plugin sends is not the Host's own message, so a line has a ceiling.
describe('a line past the ceiling', () => {
  it('is reported once, and nothing after it is read', async () => {
    const got: unknown[] = []
    let overflows = 0
    const peer = createRpcPeer({ send: () => {}, onRequest: async (_m, p) => (got.push(p), {}), maxLine: 50, onOverflow: () => (overflows += 1) })
    peer.feed('x'.repeat(30))
    peer.feed('x'.repeat(30))
    peer.feed('\n{"jsonrpc":"2.0","id":1,"method":"m","params":1}\n')
    await new Promise((r) => setImmediate(r))
    expect(overflows).toBe(1)
    expect(got).toEqual([])
  })
})

// 5d (performance review M2 and L4): a request its asker no longer waits for is cancelled, on both sides
describe('cancelling a request', () => {
  const RPC_CANCELLED = -32800
  const lineOf = (l: string): unknown => JSON.parse(l.slice(2))

  it('rejects at once, tells the other side, aborts its handler, and the other side does not answer it', async () => {
    let seen: AbortSignal | undefined
    const bad: string[] = []
    const lines: string[] = []
    let a: ReturnType<typeof createRpcPeer> | undefined
    const b = createRpcPeer({
      send: (l) => (lines.push(`b>${l}`), setImmediate(() => a?.feed(l))),
      onRequest: (_m, _p, signal) =>
        new Promise((r) => {
          seen = signal
          setTimeout(() => r('late'), 300)
        })
    })
    a = createRpcPeer({ send: (l) => (lines.push(`a>${l}`), setImmediate(() => b.feed(l))), onRequest: async () => ({}), onBadMessage: (m) => bad.push(m) })
    const ctl = new AbortController()
    const asked = a.request('slow', {}, { signal: ctl.signal })
    await vi.waitFor(() => expect(seen).toBeDefined())
    ctl.abort()
    await expect(asked).rejects.toMatchObject({ code: RPC_CANCELLED })
    await vi.waitFor(() => expect(seen?.aborted).toBe(true))
    expect(lines.map(lineOf)).toContainEqual({ jsonrpc: '2.0', method: '$/cancel', params: { id: 1 } })
    await new Promise((r) => setTimeout(r, 400))
    expect(lines.filter((l) => l.startsWith('b>'))).toEqual([])
    expect(bad).toEqual([])
  })

  it('sends nothing for a signal that was aborted before it was asked', async () => {
    const lines: string[] = []
    const a = createRpcPeer({ send: (l) => void lines.push(l), onRequest: async () => ({}) })
    await expect(a.request('x', {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: RPC_CANCELLED })
    expect(lines).toEqual([])
  })

  it('drops a late answer to a request it cancelled without a word', async () => {
    const bad: string[] = []
    const a = createRpcPeer({ send: () => {}, onRequest: async () => ({}), onBadMessage: (m) => bad.push(m) })
    const ctl = new AbortController()
    const asked = a.request('x', {}, { signal: ctl.signal })
    ctl.abort()
    await expect(asked).rejects.toMatchObject({ code: RPC_CANCELLED })
    a.feed('{"jsonrpc":"2.0","id":1,"result":"late"}\n')
    expect(bad).toEqual([])
  })

  // 5d final review M1: the ids it cancelled are remembered to drop their late answers, the last 1,000 of them only
  it('remembers only the last 1,000 cancelled ids', async () => {
    const bad: string[] = []
    const a = createRpcPeer({ send: () => {}, onRequest: async () => ({}), onBadMessage: (m) => bad.push(m) })
    for (let i = 0; i < 1_001; i++) {
      const ctl = new AbortController()
      const asked = a.request('x', {}, { signal: ctl.signal }).catch(() => {})
      ctl.abort()
      await asked
    }
    a.feed('{"jsonrpc":"2.0","id":1001,"result":"late"}\n')
    expect(bad).toEqual([])
    a.feed('{"jsonrpc":"2.0","id":1,"result":"late"}\n')
    expect(bad).toEqual(['an answer to no request in flight (id 1)'])
  })

  // 5d final review M2: a cancel that comes after the answer, on either side, changes nothing
  it('a cancel after the answer sends nothing, and one that arrives after answering is ignored', async () => {
    const lines: string[] = []
    const a = createRpcPeer({ send: (l) => void lines.push(l), onRequest: async () => ({}) })
    const ctl = new AbortController()
    const asked = a.request('x', {}, { signal: ctl.signal })
    a.feed('{"jsonrpc":"2.0","id":1,"result":"done"}\n')
    expect(await asked).toBe('done')
    ctl.abort()
    expect(lines).toHaveLength(1)
    const answered: string[] = []
    const b = createRpcPeer({ send: (l) => void answered.push(l), onRequest: async () => 'ok' })
    b.feed('{"jsonrpc":"2.0","id":5,"method":"x","params":{}}\n')
    await vi.waitFor(() => expect(answered).toHaveLength(1))
    b.feed('{"jsonrpc":"2.0","method":"$/cancel","params":{"id":5}}\n')
    await new Promise((r) => setImmediate(r))
    expect(answered).toHaveLength(1)
  })

  it('a cancel for a request it does not hold does nothing, and is not a request', async () => {
    const methods: string[] = []
    const lines: string[] = []
    const b = createRpcPeer({ send: (l) => void lines.push(l), onRequest: async (m) => void methods.push(m) })
    b.feed('{"jsonrpc":"2.0","method":"$/cancel","params":{"id":99}}\n')
    await new Promise((r) => setImmediate(r))
    expect(methods).toEqual([])
    expect(lines).toEqual([])
  })

  it('closing aborts every request it is answering', async () => {
    let seen: AbortSignal | undefined
    const b = createRpcPeer({
      send: () => {},
      onRequest: (_m, _p, signal) => {
        seen = signal
        return new Promise(() => {})
      }
    })
    b.feed('{"jsonrpc":"2.0","id":7,"method":"slow","params":{}}\n')
    await vi.waitFor(() => expect(seen).toBeDefined())
    b.close('gone')
    expect(seen?.aborted).toBe(true)
  })
})
