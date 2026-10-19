// Who owns the chat connections in this app (Slack in the Host, spec S1, plan rulings P4 and P5): the app's
// own notifiers, Slack socket and Telegram poller, or a Host that announced `slack-owner`. Exactly one of
// them holds every connection at a time; the wire names (`slack-owner`, the `slack` yield, `slack-event`,
// `slack-reload`) predate Telegram and now cover all of them, so Telegram never has two pollers (409). Below,
// "Slack" reads as "the connections". A Host without the Slack SDK announces no `slack-owner`, so the app
// then holds Telegram too.
//
// - Nothing is decided before the startup chain settles (`settled`), unless a Slack-owning Host answers
//   first: before the first handshake the app cannot know whether one is there, and opening its socket at
//   once would put two sockets on one token for the length of the handshake (P5).
// - A Host that stops owning Slack (a close clears the features) gets `SLACK_HANDBACK_MS` before the app
//   builds its own; a Slack-owning handshake inside it cancels the hand-back. An unresponsive Host still
//   owns Slack (hostSpeaksSlackOwner's rule).
// - **The hello's slack yield follows what this app holds** (Task 8 carry 3). The Host opens its socket the
//   moment a hello that yields `slack` reaches it, before the app hears the reply. So a hello sent while this
//   app holds its socket leaves the yield out (`helloKeeps`), the Host stays inactive in front of it, and the
//   app keeps Slack for that connection. The Host takes Slack when this app goes, or at a later hello sent
//   while the app holds nothing.
// - **Nothing is lost while the Host is away** (final review M2, M3). A forward made while the Slack-owning
//   Host is not connected (the hand-back grace, or an unresponsive Host) is held: it goes to the Host when it
//   answers again, or to this app's own notifier (`hear`) when the grace ends and the app takes Slack. A
//   settings save made before a Slack-owning Host can hear it (ownership undecided, or the Host away) is
//   sent as slack-reload the next time a Slack-owning Host answers.
import type { ForwardedEvent } from '../core/connections/forwarded'
import { hostSpeaksSlackOwner } from './host/outdated'

export const SLACK_HANDBACK_MS = 15_000
/** The most forwards held while the Host is away; the oldest go first. A grace is 15 s, so this is far
 *  more than one holds unless something is wrong. */
const HELD_MAX = 200

export type ConnectionsOwner = 'undecided' | 'app' | 'host'

/** One connection as this gate holds it: what its settings file says, applied here, or stood down. */
export interface OwnedConnection<C = unknown> {
  name: string
  load(): Promise<C>
  /** The connection's notifier transport and inbox, from `cfg`. */
  apply(cfg: C): void
  /** No transport and no inbox. */
  stop(): void
}

export interface ConnectionsOwnership {
  owner(): ConnectionsOwner
  /** The app's own notifier hears its inputs: it owns Slack, or nobody decided yet (it posts nothing then). */
  local(): boolean
  /** The startup chain settled (hostSessionsTakenBack): decide now. */
  settled(): void
  /** Every Host client status change. */
  status(s: { connected: boolean; unresponsive?: boolean; features: readonly string[] }): void
  /** Asked by the Host client at every hello: true while this app holds Slack, so that hello leaves the
   *  `slack` yield out. A hello that yields while the hand-back grace runs restarts the grace. */
  helloKeeps(): boolean
  /** The Host half, bound by ipc.ts once its client exists. */
  setHost(h: { reload(): Promise<void>; forward(ev: ForwardedEvent): void } | null): void
  /** Sent to the Host only while it owns Slack; false otherwise. Never throws. */
  forward(ev: ForwardedEvent): boolean
  /** A settings screen wrote connection `name`'s file: applied here when the app owns, sent as slack-reload
   *  (which reloads every connection) when the Host does. */
  configChanged(name: string, cfg: unknown): Promise<void>
  dispose(): void
}

export function createConnectionsOwnership(d: {
  /** Every connection, held together (main/index.ts's list). */
  connections: readonly OwnedConnection[]
  /** A forward held while the Host was away, told to this app's own notifier once it takes Slack. */
  hear?(ev: ForwardedEvent): void
  after(ms: number, fn: () => void): () => void
  log(m: string): void
}): ConnectionsOwnership {
  let owner: ConnectionsOwner = 'undecided'
  let hostOwns = false
  /** What the last hello said: true when it left the slack yield out because this app held Slack. */
  let lastHelloKept = false
  /** Said once per stretch of keeping Slack in front of a Slack-owning Host. */
  let toldKept = false
  let cancel: (() => void) | null = null
  let host: { reload(): Promise<void>; forward(ev: ForwardedEvent): void } | null = null
  /** The Host client is connected: a forward sent now reaches it. */
  let linked = false
  let held: ForwardedEvent[] = []
  let toldDropped = false
  /** A settings save no Slack-owning Host has heard yet. */
  let reloadOwed = false
  const log = (m: string): void => {
    try {
      d.log(m)
    } catch {
      /* nowhere to say it */
    }
  }
  const disarm = (): void => {
    cancel?.()
    cancel = null
  }
  const arm = (): void => {
    disarm()
    cancel = d.after(SLACK_HANDBACK_MS, () => {
      cancel = null
      if (!hostOwns) toApp('the Host that owned Slack is gone')
    })
  }
  const toHost = (): void => {
    disarm()
    toldKept = false
    if (owner === 'host') return
    owner = 'host'
    log('slack: the Host owns Slack — this app opens no socket and posts nothing')
    for (const c of d.connections) {
      try {
        c.stop()
      } catch (err) {
        log(`slack: this app could not stand its ${c.name} down: ${String(err)}`)
      }
    }
  }
  /** Sends what was held while the Host was away, oldest first. Stops at a client that throws, and what is
   *  left stays held. */
  const flushHeld = (): void => {
    while (held.length > 0 && host) {
      try {
        host.forward(held[0])
      } catch (err) {
        log(`slack: a held event could not be forwarded: ${String(err)}`)
        return
      }
      held.shift()
    }
  }
  /** The held forwards, told to this app's own notifier: the app owns Slack now. */
  const replayHeld = (): void => {
    const evs = held
    held = []
    for (const ev of evs) {
      try {
        d.hear?.(ev)
      } catch (err) {
        log(`slack: a held event could not be told here: ${String(err)}`)
      }
    }
  }
  const sendReload = (): void => {
    if (!host) return
    reloadOwed = false
    void host.reload().catch((err) => {
      reloadOwed = true
      log(`slack: the Host did not reload slack.json: ${String(err)}`)
    })
  }
  const toApp = (why: string): void => {
    disarm()
    if (owner === 'app') return
    owner = 'app'
    // toApp reads the file itself, so no reload is owed to anyone.
    reloadOwed = false
    log(`slack: this app owns Slack (${why})`)
    void Promise.all(
      d.connections.map((c) =>
        c
          .load()
          .then((cfg) => {
            if (owner === 'app') c.apply(cfg)
          })
          .catch((err) => log(`slack: ${c.name}.json could not be read or applied: ${String(err)}`))
      )
    ).finally(() => {
      if (owner === 'app') replayHeld()
    })
  }
  return {
    owner: () => owner,
    local: () => owner !== 'host',
    settled: () => {
      if (owner === 'undecided') {
        if (hostOwns) toHost()
        else toApp('no Slack-owning Host answered')
      }
    },
    status: (s) => {
      hostOwns = hostSpeaksSlackOwner(s)
      linked = s.connected
      if (hostOwns) {
        // This connection's hello kept Slack here: the Host holds no socket in front of this app, and taking
        // this app's down would leave nobody with one. It stays until this app goes (or a later hello yields).
        if (owner === 'app' && lastHelloKept) {
          disarm()
          if (!toldKept) log('slack: a Slack-owning Host answered, but this app held Slack when it said hello — it keeps Slack, and the Host stays inactive')
          toldKept = true
          return
        }
        toHost()
        if (linked) {
          flushHeld()
          if (reloadOwed) sendReload()
        }
        return
      }
      // P5: a Host that stopped owning Slack gets the grace; a close clears the features on every blip.
      if (owner === 'host' && cancel === null) arm()
    },
    helloKeeps: () => {
      lastHelloKept = owner === 'app'
      // A yielding hello the Host may take: the grace starts over, so it cannot fire under a Host that
      // opened its socket on this hello but has not answered yet.
      if (!lastHelloKept && cancel !== null) arm()
      return lastHelloKept
    },
    setHost: (h) => {
      host = h
    },
    forward: (ev) => {
      if (owner !== 'host' || !host) return false
      if (!linked || held.length > 0) {
        // The Host is away: held until it answers, or until this app takes Slack (M2).
        held.push(ev)
        if (held.length > HELD_MAX) {
          held.shift()
          if (!toldDropped) log(`slack: more than ${HELD_MAX} events held while the Host was away, the oldest dropped`)
          toldDropped = true
        }
        if (linked) flushHeld()
        return true
      }
      try {
        host.forward(ev)
        return true
      } catch (err) {
        log(`slack: an event could not be forwarded: ${String(err)}`)
        return false
      }
    },
    configChanged: async (name, cfg) => {
      if (owner === 'app') d.connections.find((c) => c.name === name)?.apply(cfg)
      // M3: whenever a Slack-owning Host is there, it hears the save, even one it is not active for (it reads
      // the file again on activation anyway). Otherwise the save is owed to the next one that answers.
      if (hostOwns && linked && host) {
        reloadOwed = false
        await host.reload().catch((err) => {
          reloadOwed = true
          log(`slack: the Host did not reload ${name}.json: ${String(err)}`)
        })
      } else if (owner !== 'app') reloadOwed = true
    },
    dispose: () => {
      disarm()
      held = []
    }
  }
}
