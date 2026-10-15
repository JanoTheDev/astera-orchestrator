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
/** The asker stopped waiting (5d): its request is cancelled, as LSP's RequestCancelled. */
export const RPC_CANCELLED = -32800
/** The notification a cancelled request's id is sent in (5d). It is the protocol's own, never a request. */
export const RPC_CANCEL = '$/cancel'
/** How many cancelled ids a peer remembers to drop their late answers: the other side answers none it supports. */
const CANCELLED_KEPT = 1_000

export interface RpcPeer {
  /** Asks the other side. With `signal`, aborting it cancels the request: it rejects with RPC_CANCELLED at once, the
   *  other side is told (`$/cancel`), and an answer that still comes is dropped. */
  request(method: string, params: unknown, opts?: { signal?: AbortSignal }): Promise<unknown>
  /** What arrived on the channel, in chunks as they came. */
  feed(chunk: string): void
  /** The channel ended: every request in flight, and every later one, fails with `reason`. */
  close(reason: string): void
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function createRpcPeer(o: {
  send(line: string): void
  /** `signal` aborts when the asker cancels this request, or the channel ends; a cancelled request is not answered. */
  onRequest(method: string, params: unknown, signal: AbortSignal): Promise<unknown>
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
  /** Requests this side cancelled: an answer that still comes is dropped without a word. */
  const cancelled = new Set<number>()
  /** Requests the other side asked that are being answered, by their id: a cancel aborts one. */
  const answering = new Map<unknown, AbortController>()
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
      // The other side stopped waiting for one of its requests (5d): its handler's signal aborts, and it is not answered
      if (m.method === RPC_CANCEL && m.id === undefined) {
        const id = isObject(m.params) ? m.params.id : undefined
        answering.get(id)?.abort()
        answering.delete(id)
        return
      }
      // A notification (no id) asks for no answer, and cannot be cancelled.
      const id = m.id
      const ctl = new AbortController()
      if (id !== undefined) answering.set(id, ctl)
      // Answered only when it is still the request in flight under this id: a cancelled one is not
      const current = (): boolean => {
        if (id === undefined || answering.get(id) !== ctl) return false
        answering.delete(id)
        return true
      }
      o.onRequest(m.method, m.params, ctl.signal).then(
        (result) => {
          if (current()) answer(id, { result: result ?? null })
        },
        (e: unknown) => {
          if (!current()) return
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
    if (cancelled.delete(m.id)) return
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
    request(method, params, opts) {
      if (closed !== null) return Promise.reject(new RpcError(RPC_CLOSED, closed))
      const signal = opts?.signal
      if (signal?.aborted) return Promise.reject(new RpcError(RPC_CANCELLED, `${method} was cancelled`))
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const onAbort = (): void => {
          if (!waiting.delete(id)) return
          cancelled.add(id)
          if (cancelled.size > CANCELLED_KEPT) cancelled.delete(cancelled.values().next().value as number)
          reject(new RpcError(RPC_CANCELLED, `${method} was cancelled`))
          if (closed === null) o.send(encodeLine({ jsonrpc: '2.0', method: RPC_CANCEL, params: { id } }))
        }
        const done = (): void => signal?.removeEventListener('abort', onAbort)
        waiting.set(id, {
          resolve: (v) => (done(), resolve(v)),
          reject: (e) => (done(), reject(e))
        })
        signal?.addEventListener('abort', onAbort, { once: true })
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
      for (const ctl of answering.values()) ctl.abort()
      answering.clear()
    }
  }
}
