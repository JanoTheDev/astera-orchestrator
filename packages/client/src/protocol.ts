// The messages a client and the Host say to each other to connect and to run one command. This is the part of the
// Host protocol that @astera-app/client speaks; the Astera app compiles against these same definitions.

/** Bumped only when a message changes shape. A Host and a client that disagree on this number do not talk, so a bump
 *  also means an older Host has to be replaced before a client can reach it. Anything added since is announced in the
 *  Host's `hello.features` instead, so the number stays put and a running Host keeps working.
 *
 *  2 added the pty-* messages: the Host owns the terminals. 3 added pty-note: an older Host answers a message it does
 *  not know by logging it and carrying on, so a client that kept talking to one would have every note update silently
 *  dropped. The version guard exists to make that impossible.
 *
 *  4 added the Host's proof (`hello.nonce` answered by `hello.proof`, hostKey.ts). On Windows another account can
 *  create the pipe first, and a client has no other way to tell a genuine Host from a squatter. This could not be
 *  additive: a client that must refuse a Host without a proof would refuse every older Host, so the number moved, the
 *  address moved with it, and an older Host is sent away. Its terminals end with it, once. */
export const HOST_PROTOCOL = 4

/** Request receipts — `orch-call.request`, the `requests-show` command, and the replay that makes a
 *  retry safe. Announced in the Host's hello `features`, like every
 *  capability added after protocol 3: the protocol number stays, because bumping it retires a Host that
 *  is running perfectly well and kills its terminals with it.
 *
 *  **Why a feature flag is not optional for this one.** A Host from before it destructures
 *  `{cmd, args, session}` and runs the command *unprotected* while the caller believes otherwise —
 *  the silent drop this whole design is built against. So the CLI splits: a **presented**
 *  `--request-id` against a Host that does not announce this is refused with exit 9 (the caller asked
 *  for protection and is not getting it), while an **auto-minted** id is dropped and the command runs
 *  exactly as it did before receipts existed. We refuse to break a promise we made, and we never
 *  refuse over one we did not. */
export const HOST_FEATURE_REQUESTS = 'requests'

/** The `orch-call`/`orch-result` pair: one RPC channel for every
 *  orchestration command instead of a message type per command. Announced in the Host's hello
 *  `features`, so the protocol number stays: a Host from before it answers an `orch-call` the way it
 *  answers any message it does not know, logged and ignored, and a client that sends one anyway waits
 *  for an answer that never comes. The CLI, the MCP link and @astera-app/client check for it first. */
export const HOST_FEATURE_ORCH = 'orch'

/** `events-poll`: the Host keeps a public event log beside its state and answers reads of it. A Host from
 *  before it answers the command 501; @astera-app/client checks for this first and says what to update. */
export const HOST_FEATURE_EVENTS = 'events'

/** `app` is a version string: the Astera app sends its version, the CLI (through
 *  connect.ts) its own, and @astera-app/client `sdk-<version>`. The first two can be the identical
 *  string, so it cannot say *what* is connecting. `role` does.
 *
 *  **Absent means `'cli'`, and that default is the careful one.** The Host sends `orch-act` only to
 *  a client that called itself the app; an older app that sends no role is therefore refused with
 *  APP_REQUIRED rather than handed an `orch-act` it has never heard of and cannot answer, which
 *  would leave the caller waiting for a reply that is never coming. Additive, so HOST_PROTOCOL
 *  stays 3 — bumping it retires a running Host and takes its terminals with it.
 *
 *  **`yields` names the duties this app hands to the Host**: with
 *  HOST_YIELD_WORKTREES in it, the Host forks, merges and removes Job worktrees itself while this
 *  app is attached. Absent means none, which is what an S2 app sends: the Host then keeps sending
 *  that work to it, because such an app writes worktrees.json whole and would erase an entry the
 *  Host made behind it. An older Host ignores the field, so a new app in front of one keeps S2's
 *  behaviour. Additive, so HOST_PROTOCOL stays 3.
 *
 *  **`pid` is the app's own process id.** The Host keeps the last one an app
 *  gave and asks whether it lives when the profile's `app.pid` names no live app (a profile the app
 *  could not write). Absent from an older app and from the CLI, and then `app.pid` alone answers, as
 *  before. Additive, so HOST_PROTOCOL stays 3.
 *
 *  **`nonce`** (protocol 4): the Host answers it with `proof` (hostKey.ts), and the client
 *  sends nothing more until that proof checks out.
 *
 *  **`client`** is the MCP client an `mcp` socket serves, as its MCP `initialize` named itself. The Host
 *  keeps it per socket and journals it on that socket's rows, cleaned again on arrival (by the app's
 *  continuity actor, `mcpClientOf`), and ignores it from any other role. Additive, so
 *  HOST_PROTOCOL stays 4.
 *
 *  **`remote`** is the network address of the caller an `mcp` socket serves when it came over HTTP
 *  (`astera mcp http`); absent over stdio. Additive, so HOST_PROTOCOL stays 4. */
export interface ClientHelloMessage {
  t: 'hello'
  protocol: number
  app: string
  role?: 'app' | 'cli' | 'mcp'
  yields?: string[]
  /** What this client reads beyond the base protocol (`pty-seq`). Unknown names are
   *  ignored, so a newer client can ask for more than an older Host offers. */
  features?: string[]
  pid?: number
  nonce?: string
  client?: { name: string; version?: string }
  remote?: string
}

/** One RPC call, routed by `cmd`. `call` is the caller's own
 *  correlation id — one socket can have several `orch-call`s outstanding at once, so the reply
 *  names which one it answers. `args`/`session` are today's HTTP body and `x-astera-session`
 *  header, carried unchanged. Answered only for a socket that has said hello — the Host's
 *  `greetedSockets` guard — the same rule every other reply already follows. */
/** `request` is the caller's own id for the *request*, as opposed to `call`, which is its id for
 *  this attempt on this socket. It rides the envelope rather than
 *  `args` because it is not an argument to any command: no `case` in `handleCommand` reads it, and
 *  the Host decides from it alone whether this call is a first attempt or a retry of one it has
 *  already answered. Additive, so HOST_PROTOCOL stays 3 — a Host from before it destructures
 *  `{cmd, args, session}` and runs the command unprotected, which is why the CLI must not send a
 *  *presented* id to a Host that has not announced the feature. */
export interface OrchCallMessage { t: 'orch-call'; call: string; cmd: string; args: Record<string, unknown>; session?: string; request?: string }

export interface HostHelloMessage {
  t: 'hello'
  protocol: number
  host: string
  pid: number
  startedAt: string
  /** What this Host can do beyond protocol 3's original set. Optional because older Hosts do not
   *  send it — absent means none. Additive on purpose: the protocol stays 3 (see HOST_PROTOCOL's
   *  comment). */
  features?: string[]
  /** True while an app 1.3.25 or older is attached: one whose hello carried no
   *  role. `astera host status` says so and asks for the update. Absent otherwise, and from an
   *  older Host. Additive, so HOST_PROTOCOL stays 3. */
  legacyApp?: true
  /** HMAC of the client's `nonce` under the profile's Host key (`hostKey.ts`). Sent only
   *  in answer to a nonce. */
  proof?: string
  /** A random 128-bit value this Host process made once at start: a client that
   *  sees it change knows every counter it holds came from a Host that is gone. Absent from an older Host. */
  bootId?: string
}

export interface ProtocolMismatchMessage { t: 'protocol-mismatch'; protocol: number }

/** Answers one `orch-call`, carrying its `call` back so the asker can match the reply to the
 *  request that made it. `status`/`body` are today's HTTP status and body, unchanged.
 *
 *  **`replayed` says this answer came out of a receipt rather than out of a run of the command**
 *  Present only when the `request` this call carried had already
 *  taken effect on this Host: the command was not run a second time, and the CLI puts the same
 *  word at the top level of the envelope it prints.
 *
 *  **`observed` is the other kind of answer to a repeated id, and it is deliberately not the same
 *  word**. A command that committed and then waited is replayed by *observing*: the
 *  commit is not repeated, but the command does run again and the body is what is true now — for
 *  `check --ack <id> --wait` that is a fresh poll, which can open a new delivery the caller has
 *  never seen. Calling that `replayed` would publish a sentence ("the command was not run a second
 *  time") that is false for it, and a caller that skips a body it believes it has already handled
 *  would drop that batch and its delivery id. So an older reader, which knows only `replayed`, sees
 *  no marker at all here and treats the answer as the first answer it is.
 *
 *  Both are absent rather than `false` when they do not apply, so no older Host has to learn to
 *  send them and a reader can test for them with `?.`. */
export interface OrchResultMessage { t: 'orch-result'; call: string; status: number; body: unknown; replayed?: true; observed?: true }
