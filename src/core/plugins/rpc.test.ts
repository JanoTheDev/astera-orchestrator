import { describe, it, expect } from 'vitest'
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
