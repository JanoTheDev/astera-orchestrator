// The sentences Settings › Remote Runtimes shows (remote runtime design Phase 6), apart from the component so each
// is tested as text.
import type { RemoteApi } from '../../../core/types'

type T = (key: never, params?: Record<string, string | number>) => string
type ThisMachine = Awaited<ReturnType<RemoteApi['thisMachine']>>
type Ping = Awaited<ReturnType<RemoteApi['ping']>>

/** This computer as a Runtime: unknown when its Host cannot say, off, or on with where it listens. */
export function thisMachineLine(s: ThisMachine, t: T): string {
  const tt = t as (k: string, p?: Record<string, string | number>) => string
  if (s === null) return tt('settings.remote.thisMachine.unknown')
  const g = s.gateway as { state: string; listen?: string; port?: number }
  if (g.state === 'disabled') return tt('settings.remote.thisMachine.off')
  return tt('settings.remote.thisMachine.on', { listen: g.listen ?? '?', port: g.port ?? '?', state: g.state })
}

/** What a ping found: who answered, or the code it failed with. */
export function pingLine(p: Ping, t: T): string {
  const tt = t as (k: string, p?: Record<string, string | number>) => string
  if (!p.ok) return tt('settings.remote.paired.offline', { code: p.code })
  return tt('settings.remote.paired.online', { version: p.hello?.asteraVersion ?? '?', platform: p.hello?.platform ?? '?' })
}

/** A paired Runtime that did not answer the last time this app asked it, or null (review minor). */
export function pairedStateLine(r: { offline: boolean | null }, t: T): string | null {
  return r.offline === true ? (t as (k: string) => string)('settings.remote.paired.notAnswering') : null
}

/** A refusal as a person reads it: its code, then its sentence. */
export function failureLine(r: { ok: false; code: string; message: string }, t: T): string {
  return (t as (k: string, p?: Record<string, string | number>) => string)('settings.remote.failed', { code: r.code, message: r.message })
}

/** An address to listen on, named with where it is: its interface, or this computer only for 127.0.0.1. */
export function addressLabel(c: { address: string; iface: string | null; local: boolean }, t: T): string {
  const tt = t as (k: string, p?: Record<string, string | number>) => string
  return c.local ? tt('settings.remote.start.local', { address: c.address }) : tt('settings.remote.start.iface', { address: c.address, iface: c.iface ?? '' })
}

/** How long a pairing string has left, as m:ss, or that it is spent (also for a time that cannot be read). */
export function pairingLeftLine(expiresAt: string, now: number, t: T): string {
  const tt = t as (k: string, p?: Record<string, string | number>) => string
  const left = Date.parse(expiresAt) - now
  if (!Number.isFinite(left) || left <= 0) return tt('settings.remote.newPair.expired')
  const s = Math.ceil(left / 1000)
  return tt('settings.remote.newPair.expires', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })
}

/** Whether a pairing string stays on screen: while it is live and Remote is on (nothing can redeem it otherwise). */
export function pairingStillShown(p: { expiresAt: string }, mine: ThisMachine, now: number): boolean {
  if (mine === null || (mine.gateway as { state: string }).state === 'disabled') return false
  const at = Date.parse(p.expiresAt)
  return Number.isFinite(at) && at > now
}
