// The Host's Slack as one connection (core/connections/connection.ts): its notifier, posting through the
// SDK's poster or the webhook slack.json selects, and its Socket Mode inbox, whose replies take the Host's
// routes (connectionsRoutes.ts). slack.json is read through SlackConfigReader, which has no way to change
// the file; the app's settings screen stays its only writer (spec S4).
//
// Imports only core modules, node builtins and this folder: this bundles into the Host.
import path from 'node:path'
import { lineLog } from '../core/log/logWriter'
import type { ConnectionDeps } from '../core/connections/notifier'
import type { Connection } from '../core/connections/connection'
import { SlackConfigReader, type SlackConfig } from '../core/slack/config'
import { SlackNotifier } from '../core/slack/connect'
import { SlackInboxController, type SocketClient } from '../core/slack/inbox'
import type { HostSlackSdk } from './slackSdk'
import type { ReplyRoutes } from './telegramConnection'

/** The Host's Slack log: `<profile>/slack.log`, the file the app's Slack writes too, each line marked
 *  `[host]` (P16), so one file tells what happened to a session whichever process posted. Never throws. */
export function hostSlackLog(profileDir: string): (m: string) => void {
  const log = lineLog(path.join(profileDir, 'slack.log'))
  return (m) => log(`[host] ${m}`)
}

export function hostSlackConnection(
  d: Pick<ConnectionDeps, 'getAccount' | 'readStatusPayload' | 'lang' | 'log' | 'remember'> & {
    profileDir: string
    sdk: HostSlackSdk | null
    routes(notifier: SlackNotifier): ReplyRoutes
    isQuitting(): boolean
    /** Test seam. */
    load?(): Promise<SlackConfig>
  }
): Connection<SlackConfig> {
  const reader = new SlackConfigReader(path.join(d.profileDir, 'slack.json'))
  const sdk = d.sdk
  const notifier = new SlackNotifier({
    getAccount: d.getAccount,
    readStatusPayload: d.readStatusPayload,
    lang: d.lang,
    log: d.log,
    ...(sdk ? { createPoster: (token: string) => sdk.createPoster(token) } : {}),
    ...(d.remember ? { remember: d.remember } : {})
  })
  const inbox = new SlackInboxController({
    makeDeps: (channelId, memberId) => ({
      channelId,
      memberId,
      lang: d.lang,
      log: d.log,
      resolveSession: (ts) => notifier.resolveSessionByThread(ts),
      postNote: (ts, text) => notifier.postThreadNote(ts, text),
      isOwnMessage: (ts) => notifier.isOwnMessage(ts),
      pendingChoiceShape: (sid) => notifier.pendingChoiceShape(sid),
      // Task 7: a terminal reply into its pty, a chat reply and a card answer by the writer rule.
      ...d.routes(notifier)
    }),
    // A constructor that throws would reject the controller's queue, and every later apply and stop
    // behind it would never run: the throw becomes a start that fails, which SlackInbox logs.
    createClient: (token): SocketClient => {
      try {
        return sdk!.createClient(token)
      } catch (err) {
        return {
          on: () => undefined,
          start: () => Promise.reject(err),
          disconnect: async () => {}
        }
      }
    },
    isQuitting: d.isQuitting
  })
  return {
    name: 'slack',
    notifier,
    load: d.load ?? (() => reader.load()),
    apply: async (cfg, o) => {
      if (o?.transport !== false) notifier.applyConfig(cfg)
      // Always handed on: the same key reconnects nothing, and a reload is what retries an inbox Slack
      // refused for good (invalid_auth, final review C1).
      await inbox.apply(cfg)
    },
    stop: async () => {
      try {
        notifier.setTransport(null, null)
      } catch {
        /* the socket below is what matters */
      }
      await inbox.stop().catch((err) => d.log(`the Slack socket did not close cleanly: ${String(err)}`))
    }
  }
}
