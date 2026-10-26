// The one composition of the Host's chat connections (Slack in the Host, spec §3, plan rulings P4, P7,
// P9, P16; Telegram and Discord beside it): one builder per connection (slackConnection.ts, telegramConnection.ts,
// discordConnection.ts),
// each a notifier, a read-only settings reader and an inbox, held in one list; one ConnectionFanout over
// their notifiers, which every session input goes through (connectionsSessions.ts follows the Host's
// registries, connectionsSources.ts feeds the rest and the app's forwarded events); where a reply goes
// (connectionsRoutes.ts, Task 7); and the owner gate that holds every connection only while no attached
// app keeps them (the hello yield `slack`, P4 — the wire name predates Telegram and now covers all).
//
// **Adding a connection.** One folder in src/core/ (its config, transport, inbox, ready check; see the
// header of core/connections/notifier.ts), one builder here in src/host returning a Connection
// (core/connections/connection.ts) — telegramConnection.ts is the pattern, and the app builds the same one —
// one entry in the `connections` list below and in main/index.ts's, its note keys in
// CONNECTION_NOTE_KEYS (core/connections/threadNote.ts), and one settings card in the renderer. The gate,
// the fan-out, the wire names and the per-session flag stay as they are.
//
// **Exactly one socket and one poller per profile.** The Host holds its connections only when it has the
// Slack SDK and every attached app yields `slack` (or no app is attached), and an app that keeps them
// attaching stands them down before anything else is done (`onAppsChanged` rides the hello, before its
// reply). Every change of ownership goes through one queue (`settle`), and each inbox controller
// serializes its own teardown and build, so a close and an open never overlap. A Host without the SDK
// announces no `slack-owner` and holds no connection, Telegram included: the app then holds them all
// (accepted: Telegram needs no SDK, but splitting the owner would mean a second gate and wire name).
//
// **Read only.** Each settings file is read through its reader, which has no way to change it; the app's
// settings screens stay their only writer (spec S4).
//
// **A fresh Host waits for the first hello** (final review I1). An app that spawned this Host says hello
// within milliseconds, and when that app already holds the connections, a Host that took them at start
// would open a second socket beside it until the hello arrived. So the first activation waits for the first
// app hello, or for HOST_SLACK_START_GRACE_MS when no app connects (a headless `astera host start`).
//
// **Late-bound on purpose**, as rollingWiring.ts is: `server` does not exist when index.ts builds this,
// so it is a function, read at the call, and nothing is opened until `start()`.
//
// Imports only core modules, node builtins and this folder: this bundles into the Host.
import { HOST_YIELD_SLACK } from '../core/host/protocol'
import type { SlackConfig } from '../core/slack/config'
import type { TelegramConfig } from '../core/telegram/config'
import type { DiscordConfig } from '../core/discord/config'
import type { GatewaySocketCtor } from '../core/discord/gateway'
import { ConnectionFanout } from '../core/connections/fanout'
import type { Connection } from '../core/connections/connection'
import type { ConnectionNotifier } from '../core/connections/notifier'
import type { Lang } from '../core/i18n'
import { CodexRolloutWatcher } from '../core/sessions/codexRolloutWatcher'
import { findClaudeTranscript } from '../core/history/strategies/claude'
import type { PtyRegistry } from './registry'
import type { ProcRegistry } from './procRegistry'
import type { HostServer } from './server'
import type { HostSlackSdk } from './slackSdk'
import type { HostRollEvent, HostRolling } from './rolling'
import type { HostChats } from './hostChats'
import { ROLLING_TICK_MS } from './rollingWiring'
import { createHostConnectionSessions } from './connectionsSessions'
import { createHostConnectionSources } from './connectionsSources'
import { hostInboxRoutes } from './connectionsRoutes'
import { hostSlackConnection, hostSlackLog } from './slackConnection'
import { telegramConnection, telegramLog, type ConsoleRoute } from './telegramConnection'
import { discordConnection, discordLog } from './discordConnection'
import { readFileTail } from '../core/connections/notifier'
import { extractLastTurnAssistantText } from '../core/connections/transcript'
import { extractLastAgentMessage } from '../core/connections/codexTranscript'
import { providerOf } from '../core/providers/meta'

export { hostSlackLog }

/** How long a fresh Host with no app attached waits before it takes the connections (final review I1). An
 *  app that spawned the Host connects and says hello within milliseconds of the spawn; ten seconds is far
 *  beyond that, and short for a headless Host nobody is waiting on. */
export const HOST_SLACK_START_GRACE_MS = 10_000

export interface HostConnectionsWiring {
  /** Every connection's notifier behind one object: what a session input or an activity notice goes to. */
  fanout: ConnectionFanout
  /** One connection's own notifier, by name ('slack', 'telegram', 'discord'), or null. */
  notifier(name: string): ConnectionNotifier | null
  /** The SDK is there and no attached app keeps the connections (P4). */
  active(): boolean
  /** Builds nothing until the server exists; index.ts calls it once, right after startHostServer. */
  start(): void
  /** Every connection's settings file read again and applied (the app's slack-reload). Never rejects. */
  reload(): Promise<void>
  onAppsChanged(): void
  /** A greeted app's `slack-event` body (connectionsSources.ts drops what the Host sources itself). Never throws. */
  forwarded(m: unknown): void
  /** The rolling's tap: every roll event of a chain this Host holds. Never throws. */
  onRollEvent(e: HostRollEvent): void
  /** The rolling's hook tap: every hook event of the profile. Never throws. */
  onHookEvent(sessionId: string, payload: unknown): void
  /** Sockets and pollers closed, timers stopped. Never rejects. */
  dispose(): Promise<void>
}

function defaultAfter(ms: number, fn: () => void): () => void {
  const h = setTimeout(fn, ms)
  h.unref?.()
  return () => clearTimeout(h)
}

function defaultEvery(ms: number, fn: () => void): () => void {
  const h = setInterval(fn, ms)
  h.unref?.()
  return () => clearInterval(h)
}

/** A log line never throws (R3). */
const safeLog =
  (raw: (m: string) => void) =>
  (m: string): void => {
    try {
      raw(m)
    } catch {
      /* nowhere to say it */
    }
  }

export function composeHostConnections(a: {
  profileDir: string
  sdk: HostSlackSdk | null
  registry: PtyRegistry
  procs: ProcRegistry
  statusLinePayload(sessionId: string): Promise<unknown | null>
  /** The chat adapters this Host holds (their events are its own source), or null. */
  chats: Pick<HostChats, 'has' | 'info' | 'subscribe' | 'isWriter' | 'send' | 'requests' | 'answerCard'> | null
  /** The rolling: which chains this Host holds (their rolls are its own source) and its accounts snapshot,
   *  the one read of accounts.json the Host keeps (Task 6 replaces Task 5's own snapshot with it). */
  rolling: Pick<HostRolling, 'has' | 'account'> | null
  server(): Pick<HostServer, 'appsKeep' | 'hasApp' | 'act'>
  lang(): Lang
  /** Test seams. `log` is the composition's and Slack's (slack.log); Telegram's is `telegram.log`, Discord's `discord.log`. */
  log?(m: string): void
  readConfig?(): Promise<SlackConfig>
  /** Starts or finds the Astera console (console-ensure); without it Telegram's and Discord's non-reply messages get the reply hint. */
  ensureConsole?(): Promise<{ id: string }>
  telegram?: { log?(m: string): void; readConfig?(): Promise<TelegramConfig>; fetchFn?: typeof fetch }
  discord?: { log?(m: string): void; readConfig?(): Promise<DiscordConfig>; fetchFn?: typeof fetch; WebSocketCtor?: GatewaySocketCtor }
  every?(ms: number, fn: () => void): () => void
  /** The start grace's timer (HOST_SLACK_START_GRACE_MS); returns its cancel. */
  after?(ms: number, fn: () => void): () => void
  findTranscript?(configDir: string, threadId: string): Promise<string | null>
}): HostConnectionsWiring {
  const log = safeLog(a.log ?? hostSlackLog(a.profileDir))
  const lang = (): Lang => {
    try {
      return a.lang()
    } catch {
      return 'en'
    }
  }
  let disposed = false
  let started = false
  let isActive = false
  /** The first app hello arrived, or the start grace ended with none (final review I1). */
  let decided = false
  let cancelGrace: (() => void) | null = null
  /** Each connection's config its notifier holds while active, as JSON; empty while inactive. */
  const applied = new Map<string, string>()
  /** Settles and held-back forwards still in the queue: a forward waits behind them (see `forwarded`). */
  let pending = 0

  // P9: the thread keys go into whichever entry carries the session, straight through the registry.
  const noteThread = (sid: string, patch: Record<string, unknown>): void => {
    const pty = a.registry.sessionPty(sid)
    if (pty !== null) return a.registry.note(pty, patch)
    const proc = a.procs.list().find((e) => e.alive && e.meta?.kind === 'chat' && e.meta.id === sid)
    if (proc) a.procs.note(proc.id, patch)
  }
  const getAccount = (id: string) => {
    try {
      return a.rolling?.account(id) ?? null
    } catch {
      return null
    }
  }
  // R3: every dependency a notifier calls as `void this.x()` settles, whatever the source does.
  const shared = {
    profileDir: a.profileDir,
    getAccount,
    readStatusPayload: (id: string) => {
      try {
        return Promise.resolve(a.statusLinePayload(id)).catch(() => null)
      } catch {
        return Promise.resolve(null)
      }
    },
    lang,
    remember: (sid: string, patch: Record<string, unknown>) => noteThread(sid, patch),
    // Task 7: a terminal reply into its pty, a chat reply and a card answer by the writer rule.
    routes: (notifier: Pick<ConnectionNotifier, 'chatRequestOf'>) =>
      hostInboxRoutes({ registry: a.registry, procs: a.procs, chats: a.chats, notifier, server: a.server }),
    isQuitting: () => disposed
  }
  // Telegram's and Discord's console: a message sent to it, and the text its turn ends with, read from the same transcript the
  // turn summary reads. The listener is on before the send, so a fast turn cannot be missed.
  const TURN_CAP_MS = 30 * 60_000
  const consoleRoute: ConsoleRoute | undefined =
    a.ensureConsole && a.chats
      ? {
          ensure: a.ensureConsole,
          ask: async (id, send, answered) => {
            const chats = a.chats!
            let working = false
            let rollout: string | null = null
            let off = (): void => {}
            const timer = setTimeout(() => off(), TURN_CAP_MS)
            timer.unref?.()
            const read = async (): Promise<string | null> => {
              const info = chats.info(id)
              const acc = info ? a.rolling?.account(info.accountId) : null
              if (!info || !acc) return null
              const codex = providerOf(acc) === 'codex'
              for (let attempt = 0; attempt < 4; attempt++) {
                const file = codex ? rollout : info.threadId ? await (a.findTranscript ?? findClaudeTranscript)(acc.configDir, info.threadId) : null
                const tail = file ? await readFileTail(file, 256 * 1024) : null
                const text = tail ? (codex ? extractLastAgentMessage(tail) : extractLastTurnAssistantText(tail)) : null
                if (text) return text
                await new Promise((r) => setTimeout(r, 500))
              }
              return null
            }
            off = chats.subscribe((sid, e) => {
              if (sid !== id) return
              if (e.type === 'ready') rollout = e.rolloutPath
              if (e.type !== 'status') return
              if (e.status === 'working') working = true
              else if (e.status === 'idle' && working) {
                off()
                clearTimeout(timer)
                void read().then(answered, () => answered(null))
              }
            })
            try {
              await send()
            } catch (err) {
              off()
              clearTimeout(timer)
              throw err
            }
          }
        }
      : undefined
  /** The list: one entry per connection (see the header). */
  const connections: Connection[] = [
    hostSlackConnection({ ...shared, log, sdk: a.sdk, ...(a.readConfig ? { load: a.readConfig } : {}) }),
    telegramConnection({
      ...shared,
      ...(consoleRoute ? { console: consoleRoute } : {}),
      log: safeLog(a.telegram?.log ?? telegramLog(a.profileDir, true)),
      ...(a.telegram?.readConfig ? { load: a.telegram.readConfig } : {}),
      ...(a.telegram?.fetchFn ? { fetchFn: a.telegram.fetchFn } : {})
    }),
    discordConnection({
      ...shared,
      ...(consoleRoute ? { console: consoleRoute } : {}),
      log: safeLog(a.discord?.log ?? discordLog(a.profileDir, true)),
      ...(a.discord?.readConfig ? { load: a.discord.readConfig } : {}),
      ...(a.discord?.fetchFn ? { fetchFn: a.discord.fetchFn } : {}),
      ...(a.discord?.WebSocketCtor ? { WebSocketCtor: a.discord.WebSocketCtor } : {})
    })
  ]
  const fanout = new ConnectionFanout(
    connections.map((c) => c.notifier),
    log
  )
  // P12: the Host's own codex rollout watcher, for the codex terminal sessions with notifications only; no
  // `remember` (the app and the spawner already note the mapping).
  const codex = new CodexRolloutWatcher({
    getAccount,
    onTurnComplete: (sid, p) => fanout.onCodexTurnComplete(sid, p),
    log
  })
  const sources = createHostConnectionSources({
    notifier: fanout,
    chats: a.chats,
    rolling: a.rolling,
    codex,
    findTranscript: a.findTranscript ?? findClaudeTranscript,
    log
  })
  // Built here, before `start`, so the registries are followed from composition on.
  const sessions = createHostConnectionSessions({
    registry: a.registry,
    procs: a.procs,
    notifier: fanout,
    log,
    active: () => isActive,
    onRegistered: (info, restore) => sources.sessionRegistered(info, restore),
    onNoted: (info, restore) => sources.sessionNoted(info, restore),
    onEnded: (sid) => sources.sessionEnded(sid)
  })

  let queue: Promise<void> = Promise.resolve()
  const want = (): boolean => {
    if (!started || !decided || disposed || a.sdk === null) return false
    try {
      return !a.server().appsKeep(HOST_YIELD_SLACK)
    } catch {
      // Unsure who keeps the connections: holding none is the side that never makes two.
      return false
    }
  }
  /** One settle at a time (the inbox controllers' reason): a reload racing an app leaving must not apply an
   *  older read over a newer one, and a close must be done before the next open. Each settle reads who
   *  keeps the connections when it runs, not when it was asked, so the last change wins. Never rejects. */
  const settle = (why: string): Promise<void> => {
    pending++
    queue = queue
      .then(async () => {
        if (want()) {
          let fresh = false
          for (const c of connections) {
            let cfg: unknown
            try {
              cfg = await c.load()
            } catch (err) {
              // One connection's unreadable file costs only that connection.
              log(`${c.name}.json could not be read (${why}): ${err instanceof Error ? err.name : 'unknown'}`)
              continue
            }
            if (!want()) return
            // Final review M1: while the Host stays active, a notifier keeps its transport unless its config
            // changed. Applying it again built a new transport and reset every record's thread, so a root
            // still in flight was lost and the next notice opened a second one.
            const json = JSON.stringify(cfg)
            const changed = !isActive || json !== applied.get(c.name)
            applied.set(c.name, json)
            fresh ||= changed
            await c.apply(cfg, { transport: changed }).catch((err) => log(`${c.name} settings could not be applied (${why}): ${String(err)}`))
          }
          if (!isActive) log(`this Host owns the chat connections now (${why})`)
          isActive = true
          // Every activation reads the notes again: a record from an earlier activation takes the thread
          // the app noted while it kept the connections (Task 6, the Task 5 carry).
          if (fresh) sessions.reconcile({ fromNotes: true })
        } else {
          if (isActive) log(`this Host leaves the chat connections alone (${why})`)
          isActive = false
          applied.clear()
          for (const c of connections) await c.stop()
        }
      })
      .catch((err) => log(`connections settle failed (${why}): ${String(err)}`))
      .finally(() => {
        pending--
      })
    return queue
  }
  /** The first hello, or the end of the start grace: from here on, who keeps the connections decides. */
  const decide = (): void => {
    decided = true
    cancelGrace?.()
    cancelGrace = null
  }
  const stopTick = (a.every ?? defaultEvery)(ROLLING_TICK_MS, () => {
    if (!disposed) sessions.reconcile()
  })
  return {
    fanout,
    notifier: (name) => connections.find((c) => c.name === name)?.notifier ?? null,
    active: () => isActive,
    start: () => {
      if (started || disposed) return
      started = true
      let appThere = false
      try {
        appThere = a.server().hasApp()
      } catch {
        /* unsure: wait the grace */
      }
      if (appThere) {
        decide()
        void settle('start')
        return
      }
      // Final review I1: an app that spawned this Host is about to say hello, and it may hold the connections.
      const after = a.after ?? defaultAfter
      cancelGrace = after(HOST_SLACK_START_GRACE_MS, () => {
        cancelGrace = null
        if (decided || disposed) return
        decide()
        void settle('start, no app said hello')
      })
    },
    reload: () => settle('slack-reload'),
    onAppsChanged: () => {
      if (!started) return
      decide()
      void settle('an app attached or left')
    },
    // Final review M2, the Host half: a forward that arrives while a settle is in the queue waits behind it.
    // While the Host is taking the connections, the sessions are registered only once its config is read; a
    // forward told before then finds no record and is dropped (a card lost this way leaves a reply to it
    // read as a turn).
    forwarded: (m) => {
      if (disposed) return
      if (pending === 0) return sources.forwarded(m)
      pending++
      queue = queue
        .then(() => {
          if (!disposed) sources.forwarded(m)
        })
        .catch((err) => log(`connections: a held forward failed: ${String(err)}`))
        .finally(() => {
          pending--
        })
    },
    onRollEvent: (e) => {
      if (!disposed) sources.onRollEvent(e)
    },
    onHookEvent: (sid, p) => {
      if (!disposed) sources.onHookEvent(sid, p)
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      cancelGrace?.()
      cancelGrace = null
      stopTick()
      sessions.dispose()
      sources.dispose()
      codex.stop()
      isActive = false
      await queue
      for (const c of connections) await c.stop()
    }
  }
}
