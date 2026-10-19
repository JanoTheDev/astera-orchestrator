// Slack as a connection: what the shared notifier (core/connections/notifier.ts) needs to know about
// Slack, and the step from slack.json to a transport. The notifier itself knows no Slack config; this
// file builds the transport and hands it over through the notifier's setTransport.
import { ConnectionNotifier, type ConnectionDeps } from '../connections/notifier'
import type { ConnectionTransport } from '../connections/transport'
import { BotTransport, WebhookTransport, type SlackPoster } from './transport'
import { THREAD_NOTE_KEYS } from './threadNote'
import type { SlackTransportConfig } from './ready'

export type { SlackConfig } from './config'

/** Slack's cap on the `text` field — see the same constant in core/connections/transcript.ts for why every
 *  display cap is opened to it rather than kept narrow. */
export const SLACK_TEXT_MAX = 40_000

/** What turns a config into a transport: the SDK's poster factory and fetch. */
export interface SlackTransportMakers {
  /** Supplied by whichever process applies the config (the app's createWebClient, main/slackSdk.ts, or the
   *  Host's own); with none, a bot config selects no transport (P3). */
  createPoster?: (token: string) => SlackPoster
  fetchFn?: typeof fetch // for test injection — defaults to the global fetch
  log(message: string): void
}

/** Chooses the transport from the settings, and the channel it posts to.
 *  Bot mode requires both botToken and channelId — with no channel there is nowhere to send, so it falls
 *  back to the webhook. With neither, transport becomes null and notifications are disabled entirely.
 *
 *  The parameter is SlackTransportConfig (three fields) rather than SlackConfig — appToken plays no part
 *  in choosing the transport (it is for Socket Mode receiving), so only what is needed is taken. Passing
 *  a SlackConfig is structurally compatible anyway.
 *
 *  This condition has to stay logically identical to isSlackReady() in core/slack/ready.ts.
 *  NewSessionDialog.tsx gates the notification checkbox on that function, so changing only one side
 *  brings back "it is configured but the checkbox will not turn on" — isSlackReady() is not reused here
 *  because it returns a plain bool, whereas this code has to actually narrow botToken and channelId to
 *  pass them to the BotTransport constructor, and a helper call does not narrow the types.
 *
 *  There is no default SDK constructor in core (P1: the SDK never enters core) — makers.createPoster
 *  is supplied by whichever process applies the config. With a bot config and no createPoster, nothing
 *  can be built: it is logged and the transport becomes null rather than silently falling back to the
 *  webhook (P3). Every real caller passes one. */
export function slackTransportOf(
  cfg: SlackTransportConfig,
  makers: SlackTransportMakers
): { transport: ConnectionTransport | null; channel: string | null } {
  if (cfg.botToken && cfg.channelId) {
    if (!makers.createPoster) {
      makers.log('slack: no poster for bot mode')
      return { transport: null, channel: null }
    }
    return { transport: new BotTransport(makers.createPoster(cfg.botToken), cfg.channelId), channel: cfg.channelId }
  }
  return { transport: webhookTransportOf(cfg.webhookUrl, makers.fetchFn), channel: null }
}

function webhookTransportOf(url: string | null, fetchFn?: typeof fetch): ConnectionTransport | null {
  const trimmed = url && url.trim() !== '' ? url.trim() : null
  return trimmed ? new WebhookTransport(trimmed, fetchFn ?? fetch) : null
}

export type SlackDeps = Omit<ConnectionDeps, 'name' | 'noteKeys' | 'textMax' | 'enabledFor'> &
  Omit<SlackTransportMakers, 'log'>

/** The shared notifier with Slack's name, note keys (slackThreadTs, slackChannel), text cap and session
 *  flag (slackNotify), plus the two ways Slack's settings reach it. */
export class SlackNotifier extends ConnectionNotifier {
  constructor(private readonly slackDeps: SlackDeps) {
    super({
      ...slackDeps,
      name: 'slack',
      noteKeys: THREAD_NOTE_KEYS,
      textMax: SLACK_TEXT_MAX,
      enabledFor: (info) => !!info.slackNotify
    })
  }

  /** The transport slack.json selects (slackTransportOf), swapped in through setTransport. */
  applyConfig(cfg: SlackTransportConfig): void {
    const { transport, channel } = slackTransportOf(cfg, { ...this.slackDeps, log: (m) => this.slackDeps.log(m) })
    this.setTransport(transport, channel)
  }

  /** The legacy Incoming Webhook alone. */
  setWebhookUrl(url: string | null): void {
    this.setTransport(webhookTransportOf(url, this.slackDeps.fetchFn), null)
  }
}
