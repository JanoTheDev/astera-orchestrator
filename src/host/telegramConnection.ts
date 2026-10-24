// Telegram as one connection (core/connections/connection.ts): its notifier, under Telegram's note keys
// and text cap, posting through the transport telegram.json selects (core/telegram/connect.ts), and its
// long-poll inbox, whose allowed replies take the same routes Slack's do. Built the same way in the Host
// (connectionsWiring.ts) and the app (main/index.ts), so the two never drift; whichever holds the
// connections is the only one that applies it, so there is one poller per profile (two get 409).
//
// The bot token is in the poll's URL only: no log line here or below carries it.
//
// Imports only core modules: this bundles into the Host.
import path from 'node:path'
import { lineLog } from '../core/log/logWriter'
import { ConnectionNotifier, type ConnectionDeps } from '../core/connections/notifier'
import type { Connection } from '../core/connections/connection'
import type { ReplyRouterDeps } from '../core/connections/replies'
import { TELEGRAM_NOTE_KEYS } from '../core/connections/threadNote'
import { TelegramConfigReader, type TelegramConfig } from '../core/telegram/config'
import { telegramTransportOf } from '../core/telegram/connect'
import { TELEGRAM_TEXT_MAX } from '../core/telegram/format'
import { TelegramInboxController } from '../core/telegram/inbox'
import { sanitizeChatText } from '../core/connections/input'
import { t } from '../core/i18n'

/** `<profile>/telegram.log`; the Host marks its lines `[host]`, as it does in slack.log. Never throws. */
export function telegramLog(profileDir: string, host: boolean): (m: string) => void {
  const log = lineLog(path.join(profileDir, 'telegram.log'))
  return host ? (m) => log(`[host] ${m}`) : log
}

/** Where an allowed reply goes: the process's own pty, chat and card routes. */
export type ReplyRoutes = Pick<ReplyRouterDeps, 'write' | 'isChat' | 'pendingRequest' | 'deliverChat' | 'answerChat'>

/** The Astera console as the Host runs it (connectionsWiring.ts). */
export interface ConsoleRoute {
  /** The live console session, started when none is alive (console-ensure). */
  ensure(): Promise<{ id: string }>
  /** Runs `send`, then calls `answered` once with the text of the turn it started when that turn ends (null: the
   *  turn left no text). Resolves when `send` has; rejects when it does. */
  ask(id: string, send: () => Promise<void>, answered: (text: string | null) => void): Promise<void>
}

export function telegramConnection(
  d: Pick<ConnectionDeps, 'getAccount' | 'readStatusPayload' | 'lang' | 'log' | 'remember'> & {
    profileDir: string
    /** The routes for this connection's replies; given its notifier, whose forwarded cards they read. */
    routes(notifier: ConnectionNotifier): ReplyRoutes
    /** Where a message that is not a reply goes; without it the owner is told to reply instead. */
    console?: ConsoleRoute
    isQuitting(): boolean
    /** Test seams. */
    load?(): Promise<TelegramConfig>
    fetchFn?: typeof fetch
  }
): Connection<TelegramConfig> {
  const reader = new TelegramConfigReader(path.join(d.profileDir, 'telegram.json'))
  const fetchFn = d.fetchFn ?? fetch
  const notifier = new ConnectionNotifier({
    getAccount: d.getAccount,
    readStatusPayload: d.readStatusPayload,
    lang: d.lang,
    log: d.log,
    ...(d.remember ? { remember: d.remember } : {}),
    name: 'telegram',
    noteKeys: TELEGRAM_NOTE_KEYS,
    textMax: TELEGRAM_TEXT_MAX,
    // The one per-session flag (field name kept from Slack's day) asks for every ready connection.
    enabledFor: (info) => !!info.slackNotify
  })
  /** The text and the note for the console's answer, cut to Telegram's limit. */
  const answerText = (answer: string | null): string => {
    if (!answer) return t(d.lang(), 'slack.turnDone')
    if (answer.length <= TELEGRAM_TEXT_MAX) return answer
    const note = `\n${t(d.lang(), 'telegram.console.cut')}`
    return answer.slice(0, TELEGRAM_TEXT_MAX - note.length) + note
  }
  const toConsole = d.console
    ? async (text: string, noteTo: string | undefined, routes: ReplyRoutes): Promise<void> => {
        try {
          const { id } = await d.console!.ensure()
          await d.console!.ask(
            id,
            () => routes.deliverChat?.(id, sanitizeChatText(text)) ?? Promise.reject(new Error('no chat route')),
            (answer) => void notifier.postNotice(answerText(answer))
          )
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          d.log(`telegram console: the message was not delivered (${reason})`)
          if (noteTo) await notifier.postThreadNote(noteTo, t(d.lang(), 'slack.chat.sendRefused', { reason }))
        }
      }
    : undefined
  const inbox = new TelegramInboxController({
    makeDeps: () => {
      const routes = d.routes(notifier)
      return {
        lang: d.lang,
        log: d.log,
        resolveSession: (id) => notifier.resolveSessionByThread(id),
        postNote: (id, text) => notifier.postThreadNote(id, text),
        isOwnMessage: (id) => notifier.isOwnMessage(id),
        pendingChoiceShape: (sid) => notifier.pendingChoiceShape(sid),
        replyHint: () => t(d.lang(), 'telegram.inbox.replyHint'),
        fetchFn,
        ...routes,
        ...(toConsole ? { console: (text: string, noteTo: string | undefined) => toConsole(text, noteTo, routes) } : {})
      }
    },
    isQuitting: d.isQuitting
  })
  return {
    name: 'telegram',
    notifier,
    load: d.load ?? (() => reader.load()),
    apply: async (cfg, o) => {
      try {
        if (o?.transport !== false) {
          const { transport, channel } = telegramTransportOf(cfg, fetchFn)
          notifier.setTransport(transport, channel)
        }
        await inbox.apply(cfg)
      } catch (err) {
        d.log(`telegram: the settings could not be applied (${err instanceof Error ? err.name : 'unknown'})`)
      }
    },
    stop: async () => {
      try {
        notifier.setTransport(null, null)
      } catch {
        /* the poller below is what matters */
      }
      await inbox.stop().catch((err) => d.log(`telegram: the poller did not stop cleanly (${err instanceof Error ? err.name : 'unknown'})`))
    }
  }
}
