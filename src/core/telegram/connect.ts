// Telegram as a connection: the step from the stored token and chat to the transport the shared notifier
// posts through (ConnectionNotifier.setTransport). The notifier itself knows no Telegram config.
import type { ConnectionTransport } from '../connections/transport'
import { isTelegramReady, type TelegramTransportConfig } from './ready'
import { TelegramTransport } from './transport'

/** The transport the config selects, and the chat it posts to; null/null when the token or chat is missing
 *  (the same condition as isTelegramReady, which the renderer gates its checkbox on). */
export function telegramTransportOf(
  cfg: TelegramTransportConfig,
  fetchFn: typeof fetch = fetch
): { transport: ConnectionTransport | null; channel: string | null } {
  if (!isTelegramReady(cfg)) return { transport: null, channel: null }
  return { transport: new TelegramTransport(cfg.botToken!, cfg.chatId!, fetchFn), channel: cfg.chatId }
}
