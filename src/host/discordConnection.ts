// Discord as one connection (core/connections/connection.ts), the third beside Slack and Telegram and built
// the way telegramConnection.ts is: its notifier, under Discord's note keys and text cap, posting through the
// transport discord.json selects (core/discord/connect.ts), and its Gateway inbox, whose allowed replies take
// the same routes Slack's do. Built the same way in the Host (connectionsWiring.ts) and the app
// (main/index.ts); whichever holds the connections is the only one that applies it, so there is one Gateway
// per profile.
//
// The plan workspace rides this connection rather than opening its own: it picks a session's root channel
// (`rootChannel`), hears every dispatch the inbox does not consume (`onDispatch`), and posts with this
// connection's REST client (`rest()`), so one token has one Gateway and one rate limit.
//
// The bot token is in IDENTIFY and the Authorization header only: no log line here or below carries it.
//
// Imports only core modules: this bundles into the Host.
import path from 'node:path'
import { lineLog } from '../core/log/logWriter'
import { ConnectionNotifier, type ConnectionDeps } from '../core/connections/notifier'
import type { Connection } from '../core/connections/connection'
import { DISCORD_NOTE_KEYS } from '../core/connections/threadNote'
import { sanitizeChatText } from '../core/connections/input'
import { DiscordConfigReader, type DiscordConfig } from '../core/discord/config'
import { discordTransportOf } from '../core/discord/connect'
import { DISCORD_TEXT_MAX } from '../core/discord/format'
import { DiscordInboxController } from '../core/discord/inbox'
import type { GatewaySocketCtor } from '../core/discord/gateway'
import type { DiscordRest } from '../core/discord/rest'
import type { RootChannel } from '../core/discord/transport'
import { t } from '../core/i18n'
import type { ConsoleRoute, ReplyRoutes } from './telegramConnection'

/** `<profile>/discord.log`; the Host marks its lines `[host]`, as it does in slack.log. Never throws. */
export function discordLog(profileDir: string, host: boolean): (m: string) => void {
  const log = lineLog(path.join(profileDir, 'discord.log'))
  return host ? (m) => log(`[host] ${m}`) : log
}

export interface DiscordConnection extends Connection<DiscordConfig> {
  /** The REST client of the applied token, or null while none is applied. */
  rest(): DiscordRest | null
}

export function discordConnection(
  d: Pick<ConnectionDeps, 'getAccount' | 'readStatusPayload' | 'lang' | 'log' | 'remember'> & {
    profileDir: string
    /** The routes for this connection's replies; given its notifier, whose forwarded cards they read. */
    routes(notifier: ConnectionNotifier): ReplyRoutes
    /** Where a message outside a session thread goes; without it the owner is told to reply in one instead. */
    console?: ConsoleRoute
    /** The channel a session's root goes to; null (or absent) for the default #sessions. */
    rootChannel?: RootChannel
    /** Every Gateway dispatch the inbox does not consume; true means handled, so it never reaches the console. */
    onDispatch?(type: string, data: unknown): boolean
    isQuitting(): boolean
    /** Test seams. */
    load?(): Promise<DiscordConfig>
    fetchFn?: typeof fetch
    WebSocketCtor?: GatewaySocketCtor
  }
): DiscordConnection {
  const reader = new DiscordConfigReader(path.join(d.profileDir, 'discord.json'))
  let rest: DiscordRest | null = null
  const notifier = new ConnectionNotifier({
    getAccount: d.getAccount,
    readStatusPayload: d.readStatusPayload,
    lang: d.lang,
    log: d.log,
    ...(d.remember ? { remember: d.remember } : {}),
    name: 'discord',
    noteKeys: DISCORD_NOTE_KEYS,
    textMax: DISCORD_TEXT_MAX,
    // The one per-session flag (field name kept from Slack's day) asks for every ready connection.
    enabledFor: (info) => !!info.slackNotify
  })
  /** The console's answer, cut to Discord's limit with a note that says so. */
  const answerText = (answer: string | null): string => {
    if (!answer) return t(d.lang(), 'slack.turnDone')
    if (answer.length <= DISCORD_TEXT_MAX) return answer
    const note = `\n${t(d.lang(), 'discord.console.cut')}`
    return answer.slice(0, DISCORD_TEXT_MAX - note.length) + note
  }
  // The answer goes back to the channel the owner wrote in, not to #sessions.
  const toConsole = d.console
    ? async (text: string, channelId: string, routes: ReplyRoutes): Promise<void> => {
        try {
          const { id } = await d.console!.ensure()
          await d.console!.ask(
            id,
            () => routes.deliverChat?.(id, sanitizeChatText(text)) ?? Promise.reject(new Error('no chat route')),
            (answer) => void notifier.postThreadNote(channelId, answerText(answer))
          )
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          d.log(`discord console: the message was not delivered (${reason})`)
          await notifier.postThreadNote(channelId, t(d.lang(), 'slack.chat.sendRefused', { reason }))
        }
      }
    : undefined
  const inbox = new DiscordInboxController({
    makeDeps: () => {
      const routes = d.routes(notifier)
      return {
        lang: d.lang,
        log: d.log,
        resolveSession: (id) => notifier.resolveSessionByThread(id),
        postNote: (id, text) => notifier.postThreadNote(id, text),
        isOwnMessage: (id) => notifier.isOwnMessage(id),
        pendingChoiceShape: (sid) => notifier.pendingChoiceShape(sid),
        replyHint: () => t(d.lang(), 'discord.inbox.replyHint'),
        ...routes,
        ...(toConsole ? { console: (text: string, channelId: string) => toConsole(text, channelId, routes) } : {}),
        ...(d.onDispatch ? { onDispatch: d.onDispatch } : {}),
        ...(d.WebSocketCtor ? { WebSocketCtor: d.WebSocketCtor } : {})
      }
    },
    isQuitting: d.isQuitting
  })
  return {
    name: 'discord',
    notifier,
    rest: () => rest,
    load: d.load ?? (() => reader.load()),
    apply: async (cfg, o) => {
      try {
        if (o?.transport !== false) {
          const next = discordTransportOf(cfg, {
            ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}),
            ...(d.rootChannel ? { rootChannel: d.rootChannel } : {})
          })
          rest = next.rest
          notifier.setTransport(next.transport, next.channel)
        }
        await inbox.apply(cfg)
      } catch (err) {
        d.log(`discord: the settings could not be applied (${err instanceof Error ? err.name : 'unknown'})`)
      }
    },
    stop: async () => {
      try {
        rest = null
        notifier.setTransport(null, null)
      } catch {
        /* the Gateway below is what matters */
      }
      await inbox.stop().catch((err) => d.log(`discord: the Gateway did not stop cleanly (${err instanceof Error ? err.name : 'unknown'})`))
    }
  }
}
