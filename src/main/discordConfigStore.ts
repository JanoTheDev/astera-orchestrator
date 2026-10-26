// The discord.json writer. Stays in the app: the Host never writes this file — it only reads it through
// DiscordConfigReader (core/discord/config.ts), which this class extends.
import { promises as fs } from 'node:fs'
import { DiscordConfigReader, type DiscordConfig } from '../core/discord/config'
import { norm } from '../core/connections/norm'

export class DiscordConfigStore extends DiscordConfigReader {
  /** Returns the normalised value — so the caller does not have to write and then read it back. */
  async save(cfg: DiscordConfig): Promise<DiscordConfig> {
    const normalized: DiscordConfig = {
      botToken: norm(cfg.botToken),
      guildId: norm(cfg.guildId),
      userId: norm(cfg.userId),
      plans: cfg.plans
    }
    await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2), 'utf8')
    return normalized
  }

  /** A partial update: fields not sent (undefined) keep their stored value, null clears. A read failure throws
   *  and leaves the file untouched — load()'s all-null fallback would otherwise erase the stored token. */
  async patch(partial: Partial<DiscordConfig>): Promise<DiscordConfig> {
    const current = await this.read()
    if (!current)
      throw new Error(
        `discord.json could not be read; refusing to save over values that may still be there: ${this.filePath}`
      )
    return this.save({
      botToken: partial.botToken !== undefined ? partial.botToken : current.botToken,
      guildId: partial.guildId !== undefined ? partial.guildId : current.guildId,
      userId: partial.userId !== undefined ? partial.userId : current.userId,
      plans: partial.plans !== undefined ? partial.plans : current.plans
    })
  }
}
