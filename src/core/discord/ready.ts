// Decides whether the Discord connection is "ready", mirroring core/telegram/ready.ts. Node-free so the
// renderer's settings screen and the Host judge it with the same function and cannot drift apart.
export interface DiscordReadyConfig {
  botToken: string | null
  guildId: string | null
  userId: string | null
}

/** A setting sessions cannot work without. */
export type DiscordMissing = 'botToken' | 'guildId'

/** What is still missing before sessions can use Discord, in the order the settings screen asks for it. */
export function discordMissing(cfg: DiscordReadyConfig): DiscordMissing[] {
  const missing: DiscordMissing[] = []
  if (!cfg.botToken) missing.push('botToken')
  if (!cfg.guildId) missing.push('guildId')
  return missing
}

/** Whether the configuration can post: both the bot token and the server are set. */
export function isDiscordReady(cfg: DiscordReadyConfig): boolean {
  return discordMissing(cfg).length === 0
}

/** Whether every inbound message and interaction is blocked: no allowed user is set. Posting still works. */
export function discordRepliesBlocked(cfg: DiscordReadyConfig): boolean {
  return !cfg.userId
}
