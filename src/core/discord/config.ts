// The read-only half of discord.json settings storage, mirroring core/telegram/config.ts: the Host reads it
// through DiscordConfigReader, the app's writer (a later Task) extends it the way TelegramConfigStore does.
// It never writes the file and never puts the bot token in a log or an error message.
import { promises as fs } from 'node:fs'
import { norm } from '../connections/norm'

export interface DiscordConfig {
  botToken: string | null // from the Discord developer portal (Bot > Token)
  guildId: string | null // the Discord server the bot works in
  // The one Discord user id allowed to drive Astera (messages and interactions). A missing value blocks
  // everyone rather than allowing everyone, so a discord.json with no such field converges on the safe side.
  userId: string | null
  plans: boolean // the plan workspace (a category per project, a channel per plan); on unless stored as false
}

export const EMPTY_DISCORD_CONFIG: DiscordConfig = {
  botToken: null,
  guildId: null,
  userId: null,
  plans: true
}

/** Settings storage (<profile>/discord.json). A missing or corrupt file falls back to defaults — it does not
 *  block the app. The bot token never leaves this file: it is not put in logs or error messages. */
export class DiscordConfigReader {
  constructor(protected readonly filePath: string) {}

  /** The stored values, or null when the file is there but could not be read — not the same as "nothing is
   *  stored". A missing file (ENOENT) is a fresh install and gives defaults; an unparseable file gives defaults
   *  too, because that damage does not heal on a retry and the settings screen has to stay able to overwrite
   *  it. Anything else (EPERM, EBUSY, EMFILE …) is transient, and the values it hides are still on disk. */
  protected async read(): Promise<DiscordConfig | null> {
    let text: string
    try {
      text = await fs.readFile(this.filePath, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_DISCORD_CONFIG }
      return null
    }
    try {
      const raw = JSON.parse(text) as Record<string, unknown>
      return {
        botToken: norm(raw.botToken),
        guildId: norm(raw.guildId),
        userId: norm(raw.userId),
        plans: typeof raw.plans === 'boolean' ? raw.plans : EMPTY_DISCORD_CONFIG.plans
      }
    } catch {
      return { ...EMPTY_DISCORD_CONFIG }
    }
  }

  /** Reading is deliberately forgiving: an unreadable file leaves Discord looking unconfigured rather than
   *  keeping the app from starting. Writers must not inherit that: they need read()'s null. */
  async load(): Promise<DiscordConfig> {
    return (await this.read()) ?? { ...EMPTY_DISCORD_CONFIG }
  }
}
