// The pty supervisor (T35, owner item 25b): a small hidden process that owns the agent sessions' ptys, so a Host that
// dies does not take them with it. On win32 a ConPTY ends with the process holding its handles; on 2026-11-01 a Host
// crash ended every agent and their work was done again.
//
// **Processes.** The Host starts `out/main/pty-supervisor.js` (entry.ts) with its own executable as Node, detached and
// hidden, with one fixed command line (no argument per pty), and talks to it over the address below. A second start
// finds the first one listening and leaves. The supervisor exits by itself after SUPERVISOR_IDLE_MS with no live pty
// and no connection.
//
// **Wire.** Newline-delimited JSON both ways (src/host/framing.ts). One connection is one Host; ptys outlive it.
// **Hello.** The first line of every connection is `hello`: a nonce and its proof under the profile's Host key (the
// secret the Host's own address answers with, packages/client/src/hostKey.ts; the proofs are HMACs of their own, which
// that address never signs). A supervisor refuses (closes) a connection whose first line is anything else; it answers
// `welcome` with its own proof, and a client that does not get that within HELLO_MS of connecting drops the supervisor.
// A squatter on the address has no key to do either.
//
// **Spawn never blocks long.** The Host starts the supervisor in the background and connects in the background; a
// session spawned before it is connected starts in the Host (logged once). A spawn on a connected supervisor is
// bounded by SPAWN_BOUND_MS.
//
// **Client API** (client.ts, `PtySupervisorClient`), what a Host uses, the next one adopting after a crash included:
//   - `spawn(file, args, opts, meta)`: the Host registry's spawn. `meta.kind === 'session'` goes to the supervisor and
//     answers its pid synchronously; anything else, or every spawn while the supervisor cannot be reached, runs in
//     the Host as before (logged once).
//   - `list()`: the ptys held: `{ id, pid, note, alive }`, `note` being the `PtyMeta` the spawn carried. Ended ones
//     stay listed until a connection has been told how they ended.
//   - `attach(id, pid)`: a handle with the registry's pty shape. Its ring (the last RING_CHARS of output, kept while
//     no Host is attached too) arrives as its first data, then the live output and the exit; `write`, `resize`,
//     `kill` act on the pty. A kill ends the pty's whole process tree first, then the pty.
//   - `close()`: lets the connection go; the ptys stay.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import type { PtyMeta, PtyOpenOptions } from '../../core/host/protocol'

/** In the address: a supervisor of another build's protocol is another supervisor, never a confused peer. */
export const PTY_SUPERVISOR_PROTOCOL = 1

/** No live pty and no Host for this long, and the supervisor exits. */
export const SUPERVISOR_IDLE_MS = 60_000

/** How long a client waits, once connected, for the supervisor's `welcome` before it drops the connection. */
export const HELLO_MS = 2_000

/** The most a session spawn on a connected supervisor blocks the Host's main thread (connect 1 s + the answer). */
export const SPAWN_BOUND_MS = 2_000

// Their own HMAC messages, never hostProof's: the Host's address signs any nonce a stranger sends it (so a client can
// tell it from a squatter), so a proof built on hostProof, prefixed nonce or not, could be fetched from it.
const ptyProof = (kind: 'hello' | 'welcome', key: string, nonce: string): string =>
  createHmac('sha256', key).update(`astera-pty-supervisor-${kind}
${nonce}`).digest('hex')
/** What a client sends first: the proof of `nonce` under the Host key. */
export const helloProof = (key: string, nonce: string): string => ptyProof('hello', key, nonce)
/** What the supervisor answers with: a proof no client's hello can be replayed as. */
export const welcomeProof = (key: string, nonce: string): string => ptyProof('welcome', key, nonce)
/** Whether `proof` is the hello proof of `nonce`, in constant time. */
export function helloMatches(key: string, nonce: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false
  return timingSafeEqual(Buffer.from(helloProof(key, nonce), 'hex'), Buffer.from(proof, 'hex'))
}

/** UTF-16 units of output kept per pty: the Host registry's SCROLLBACK_CHARS. */
export const RING_CHARS = 256_000

/** The environment variable carrying the profile folder to entry.ts. */
export const SUPERVISOR_PROFILE_ENV = 'ASTERA_PTY_SUPERVISOR_PROFILE'
/** Test hook: the idle wait in ms instead of SUPERVISOR_IDLE_MS. */
export const SUPERVISOR_IDLE_ENV = 'ASTERA_PTY_SUPERVISOR_IDLE_MS'

/** A named pipe keyed by the profile on win32 (the Host's own key rule), a socket in `<profile>/host/` elsewhere. */
export function supervisorAddress(profileDir: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return path.join(profileDir, 'host', `ptys-v${PTY_SUPERVISOR_PROTOCOL}.sock`)
  const key = createHash('sha256').update(profileDir).digest('hex').slice(0, 16)
  return `\\\\.\\pipe\\astera-ptys-${key}-v${PTY_SUPERVISOR_PROTOCOL}`
}

export interface SupervisorPtyInfo {
  id: string
  pid: number
  note: PtyMeta | null
  alive: boolean
}

export type SpawnRequest = { t: 'spawn'; id: string; file: string; args: string[] | string; opts: PtyOpenOptions; note?: PtyMeta }

export type ToSupervisor =
  | { t: 'hello'; nonce: string; proof: string }
  | SpawnRequest
  | { t: 'list' }
  | { t: 'attach'; id: string }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string }
  | { t: 'pause'; id: string }
  | { t: 'resume'; id: string }

export type FromSupervisor =
  | { t: 'welcome'; proof: string }
  | { t: 'spawned'; id: string; pid: number }
  | { t: 'spawn-failed'; id: string; error: string }
  | { t: 'listed'; ptys: SupervisorPtyInfo[] }
  | { t: 'data'; id: string; data: string }
  /** `exitCode` null: the supervisor holds no such pty (an attach to one it no longer knows). */
  | { t: 'exit'; id: string; exitCode: number | null }
