// One connection to the Host for the life of `astera mcp serve` (MCP design §4). The CLI's own
// `callHost` fixes its call id to 'cli_1' and lives for one command; this link numbers its calls,
// reconnects when the Host goes, and starts one when none answers (M4). It never reads stdin or writes
// stdout.
import type { ConnectFailure, HostConnection } from '../../core/host/connect'
import { HOST_FEATURE_MCP, HOST_FEATURE_ORCH } from '../../core/host/protocol'
import type { HostAnswer } from '../run'
import type { CliErrorCode } from '../../core/orchestration/cliOutput'

/** A call that got no answer. The local link names the four codes below; a paired Runtime's link (remoteLink.ts) names
 *  the remote ones (remote runtime design §3.10). */
export type LinkFailure = { code: CliErrorCode; message: string }

export interface HostLink {
  call(cmd: string, args: Record<string, unknown>, request?: string): Promise<HostAnswer | LinkFailure>
  close(): void
}

/** How long a call with a requestId keeps trying to reach the Host again after its connection closed (T28). */
const RECONNECT_MS = 60_000

const isFailure = (c: HostConnection | ConnectFailure): c is ConnectFailure => 'error' in c

export function openHostLink(a: {
  connect(): Promise<HostConnection | ConnectFailure>
  /** Starts a Host when none answers (MCP design M4). Resolves true when one now answers. */
  startHost(): Promise<boolean>
  log(m: string): void
  /** Per-call deadline. Only wait_for_run holds on the Host, for at most MCP_LIMITS.waitSeconds
   *  (40 s), so the default leaves it 10 s for the Host's answer. */
  timeoutMs?: number
}): HostLink {
  // 50 s: Cursor cuts a tool call at 60 s and Codex documents 60 s as its default, so answering
  // TIMEOUT first lets the agent see why the call ended instead of a bare client-side cut.
  const timeoutMs = a.timeoutMs ?? 50_000
  // A connection and the calls sent on it: its close flushes only these.
  // `retry`: a call with a requestId, sent again once on the next connection when this one closes (the Host's request
  // journal answers a repeat of one it already ran).
  type Pending = { done: (r: HostAnswer | LinkFailure) => void; retry?: () => void }
  type Live = { c: HostConnection; pending: Map<string, Pending> }
  let conn: Promise<Live | LinkFailure> | null = null
  let current: Live | null = null
  let closed = false
  let next = 1

  const failureOf = (f: ConnectFailure): LinkFailure =>
    f.error === 'impostor'
      ? { code: 'PERMISSION_DENIED', message: "something answered at the Host's address but could not prove it is this account's Host" }
      : f.error === 'protocol'
        ? { code: 'VERSION_MISMATCH', message: 'the Host speaks another protocol; update Astera so the app and the CLI match' }
        : { code: 'HOST_NOT_RUNNING', message: 'Astera Host is not running and could not be started. Start it with `astera host start`.' }

  const gone: LinkFailure = { code: 'HOST_NOT_RUNNING', message: 'the Host went away during the call; retry with the same requestId' }

  const open = async (): Promise<Live | LinkFailure> => {
    let c = await a.connect()
    if (isFailure(c) && c.error === 'unreachable' && (await a.startHost())) c = await a.connect()
    if (isFailure(c)) return failureOf(c)
    if (!c.hello.features.includes(HOST_FEATURE_ORCH) || !c.hello.features.includes(HOST_FEATURE_MCP)) {
      c.close()
      return { code: 'VERSION_MISMATCH', message: `the Host (${c.hello.host}) is too old for MCP clients; update Astera` }
    }
    const live: Live = { c, pending: new Map() }
    const { pending } = live
    c.onMessage((m) => {
      if (m.t !== 'orch-result') return
      const p = pending.get(m.call)
      if (!p) return
      pending.delete(m.call)
      p.done({
        status: m.status,
        body: m.body,
        ...(m.replayed === true ? { replayed: true as const } : {}),
        ...(m.observed === true ? { observed: true as const } : {})
      })
    })
    c.onClose(() => {
      if (current === live) {
        current = null
        conn = null
      }
      a.log('the Host connection closed')
      for (const [id, p] of pending) {
        pending.delete(id)
        if (p.retry) p.retry()
        else p.done(gone)
      }
    })
    current = live
    return live
  }

  /** The connection, opened once for every caller waiting on it; a failure is not kept for the next one. */
  const live = async (): Promise<Live | LinkFailure> => {
    if (conn === null) conn = open()
    const mine = conn
    const l = await mine
    if ('code' in l && conn === mine) conn = null
    return l
  }

  return {
    async call(cmd, args, request) {
      if (closed) return { code: 'HOST_NOT_RUNNING', message: 'the MCP server is shutting down' }
      const l = await live()
      if ('code' in l) return l
      return new Promise((resolve) => {
        let settled = false
        let on: { l: Live; call: string } | null = null
        const finish = (r: HostAnswer | LinkFailure): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (on) on.l.pending.delete(on.call)
          resolve(r)
        }
        const timer = setTimeout(() => {
          finish({
            code: 'TIMEOUT',
            message: `the Host did not answer ${cmd} within ${Math.round(timeoutMs / 1000)} s; ${
              cmd === 'jobs-run'
                ? 'the Run may still be starting, check with get_job'
                : 'the command may still finish, re-read with a get_ tool'
            }`
          })
        }, timeoutMs)
        const send = (to: Live, retryOnClose: boolean): void => {
          const call = `mcp_${next++}`
          on = { l: to, call }
          to.pending.set(call, { done: finish, ...(retryOnClose && request !== undefined ? { retry: () => void again() } : {}) })
          to.c.call({ t: 'orch-call', call, cmd, args, session: '', ...(request !== undefined ? { request } : {}) })
        }
        // A Host restart (T28): reconnect with backoff, at most RECONNECT_MS in all (the call's own deadline usually ends
        // it first), and send the call once more on the new connection.
        const again = async (): Promise<void> => {
          on = null
          const deadline = Date.now() + RECONNECT_MS
          for (let wait = 250; !settled && !closed; wait = Math.min(wait * 2, 8_000)) {
            const n = await live()
            if (settled || closed) break
            if (!('code' in n) && current === n) return send(n, false)
            if (Date.now() + wait > deadline) break
            await new Promise((r) => setTimeout(r, wait))
          }
          finish(gone)
        }
        // The connection can close between its open resolving and this call resuming; its close has flushed `pending`
        // already, so a call registered on it now would wait out the whole deadline.
        if (current === l) send(l, true)
        else if (request !== undefined) void again()
        else finish(gone)
      })
    },
    close() {
      closed = true
      void conn?.then((l) => ('code' in l ? undefined : l.c.close()))
      conn = null
    }
  }
}
