// Discord as a connection: the step from the stored token and server to the transport the shared notifier
// posts through (ConnectionNotifier.setTransport), and the REST client it posts with, which the rest of the
// connection (the plan workspace) shares so one token has one rate limit. The notifier knows no Discord config.
import type { ConnectionTransport } from '../connections/transport'
import { isDiscordReady, type DiscordReadyConfig } from './ready'
import { discordRest, type DiscordRest } from './rest'
import { DiscordTransport, type RootChannel } from './transport'

/** The transport the config selects, the "channel" its threads are noted under, and its REST client; all
 *  null when the token or server is missing (isDiscordReady). The channel is the server: a thread's id is
 *  good anywhere in it, whichever channel its root went to. */
export function discordTransportOf(
  cfg: DiscordReadyConfig,
  opts: { fetchFn?: typeof fetch; rootChannel?: RootChannel } = {}
): { transport: ConnectionTransport | null; channel: string | null; rest: DiscordRest | null } {
  if (!isDiscordReady(cfg)) return { transport: null, channel: null, rest: null }
  const rest = discordRest({ token: cfg.botToken!, ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}) })
  return { transport: new DiscordTransport(rest, cfg.guildId!, opts.rootChannel), channel: cfg.guildId, rest }
}
