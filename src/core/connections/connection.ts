// One connection as its owner holds it: whichever of the app (main/connectionsOwnership.ts) or the Host
// (host/connectionsWiring.ts) holds the connections holds every one of them through this shape, so the
// owner gate never knows which connection it starts or stands down. Each connection's builder (Slack's,
// Telegram's) makes one from its notifier, its settings file and its inbox.
import type { ConnectionNotifier } from './notifier'

export interface Connection<C = unknown> {
  /** The connection's name, as in its notifier's log lines ('slack', 'telegram'). */
  readonly name: string
  readonly notifier: ConnectionNotifier
  /** The connection's settings file read again. */
  load(): Promise<C>
  /** Settings applied: the transport (only with `transport`, default true — swapping in an equal one
   *  resets every live record's thread, see ConnectionNotifier.setTransport), then the inbox, which only
   *  restarts on a change of its own. Never rejects. */
  apply(cfg: C, o?: { transport?: boolean }): Promise<void>
  /** No transport and no inbox: someone else holds the connection now. Never rejects. */
  stop(): Promise<void>
}
