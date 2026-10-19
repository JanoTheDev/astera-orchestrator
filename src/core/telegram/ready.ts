// Decides whether Telegram notifications are "ready". Node-free so the renderer can gate the new-session
// notification checkbox on the same condition connect.ts uses to pick a transport (see core/slack/ready.ts
// for the drift this single function prevents).
export interface TelegramTransportConfig {
  botToken: string | null
  chatId: string | null
}

/** Whether the configuration can send notifications: both the bot token and the chat are set. */
export function isTelegramReady(cfg: TelegramTransportConfig): boolean {
  return !!cfg.botToken && !!cfg.chatId
}
