// JSON-RPC 2.0, one message per line (plugin runtime design P9): what the Host and its plugin launcher speak over the
// plugin's stdin and stdout. Both sides ask and answer, so each end is one peer: `request` sends and waits for the
// answer with the same id, `feed` reads what arrived, and `onRequest` answers what the other side asks.
import { createLineReader, encodeLine } from '../publicContract'

/** An error a request is answered with: JSON-RPC's code and message. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

/** JSON-RPC's codes, and the two this protocol adds: a channel that ended, and a launcher whose plugin is not started
 *  yet or is stopping (the Host answers its caller as it does for a plugin that does not run: 4a final review M8). */
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603
export const RPC_CLOSED = -32000
export const RPC_NOT_READY = -32001

export interface RpcPeer {
  request(method: string, params: unknown): Promise<unknown>
  /** What arrived on the channel, in chunks as they came. */
  feed(chunk: string): void
  /** The channel ended: every request in flight, and every later one, fails with `reason`. */
  close(reason: string): void
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function createRpcPeer(o: {
  send(line: string): void
  onRequest(method: string, params: unknown): Promise<unknown>
  /** A line that is not a JSON-RPC 2.0 message: reported, and reading goes on. */
  onBadMessage?(message: string): void
  /** The longest line read, in characters. Past it `onOverflow` is called once and nothing more is read: a sender that
   *  never ends its line would otherwise grow the buffer without bound (2b final review I2). No ceiling when absent. */
  maxLine?: number
  onOverflow?(): void
}): RpcPeer {
  let nextId = 0
  let closed: string | null = null
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>()
  const bad = (m: string): void => o.onBadMessage?.(m)

  const answer = (id: unknown, outcome: { result: unknown } | { error: { code: number; message: string } }): void => {
    if (closed !== null) return
    let line: string
    try {
      line = encodeLine({ jsonrpc: '2.0', id, ...outcome })
    } catch (e) {
      // A result JSON cannot hold (a BigInt, a loop): the asker hears why, rather than waiting for an answer that never
      // comes while the throw ends this process (4a final review I3)
      const message = `the answer could not be sent: ${e instanceof Error ? e.message : String(e)}`
      line = encodeLine({ jsonrpc: '2.0', id, error: { code: RPC_INTERNAL_ERROR, message } })
    }
    o.send(line)
  }

  const onMessage = (m: unknown): void => {
    if (!isObject(m) || m.jsonrpc !== '2.0') return bad(`not a JSON-RPC 2.0 message: ${JSON.stringify(m).slice(0, 200)}`)
    if (typeof m.method === 'string') {
      // A notification (no id) asks for no answer; this protocol sends none, so one is only read.
      const id = m.id
      o.onRequest(m.method, m.params).then(
        (result) => {
          if (id !== undefined) answer(id, { result: result ?? null })
        },
        (e: unknown) => {
          if (id === undefined) return
          const error =
            e instanceof RpcError
              ? { code: e.code, message: e.message }
              : { code: RPC_INTERNAL_ERROR, message: e instanceof Error ? e.message : String(e) }
          answer(id, { error })
        }
      )
      return
    }
    if (typeof m.id !== 'number') return bad(`an answer without a numeric id: ${JSON.stringify(m).slice(0, 200)}`)
    const w = waiting.get(m.id)
    if (!w) return bad(`an answer to no request in flight (id ${m.id})`)
    waiting.delete(m.id)
    if (isObject(m.error)) w.reject(new RpcError(typeof m.error.code === 'number' ? m.error.code : RPC_INTERNAL_ERROR, String(m.error.message ?? 'error')))
    else w.resolve(m.result)
  }

  const reader = createLineReader({
    onMessage,
    onBadLine: (raw) => bad(`not JSON: ${raw.slice(0, 200)}`),
    onHandlerError: (_v, err) => bad(`a message could not be handled: ${err instanceof Error ? err.message : String(err)}`),
    ...(o.maxLine !== undefined ? { maxLine: o.maxLine, onOverflow: () => o.onOverflow?.() } : {})
  })

  return {
    request(method, params) {
      if (closed !== null) return Promise.reject(new RpcError(RPC_CLOSED, closed))
      const id = ++nextId
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        o.send(encodeLine({ jsonrpc: '2.0', id, method, params }))
      })
    },
    feed: (chunk) => {
      if (closed === null) reader(chunk)
    },
    close(reason) {
      if (closed !== null) return
      closed = reason
      for (const w of waiting.values()) w.reject(new RpcError(RPC_CLOSED, reason))
      waiting.clear()
    }
  }
}
