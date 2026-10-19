// The telegram.json writer. Stays in the app: the Host never writes this file — it only reads it through
// TelegramConfigReader (core/telegram/config.ts), which this class extends.
import { promises as fs } from 'node:fs'
import { TelegramConfigReader, type TelegramConfig } from '../core/telegram/config'
import { norm } from '../core/connections/norm'

export class TelegramConfigStore extends TelegramConfigReader {
  /** Returns the normalised value — so the caller does not have to write and then read it back. */
  async save(cfg: TelegramConfig): Promise<TelegramConfig> {
    const normalized: TelegramConfig = {
      botToken: norm(cfg.botToken),
      chatId: norm(cfg.chatId),
      userId: norm(cfg.userId)
    }
    await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2), 'utf8')
    return normalized
  }

  /** A partial update: fields not sent (undefined) keep their stored value, null clears. Merging is only safe
   *  when the current values are actually known — load()'s all-null fallback would turn a failed read into
   *  "nothing was stored" and one save later the token on disk is gone — so a read failure throws here and
   *  leaves the file untouched. */
  async patch(partial: Partial<TelegramConfig>): Promise<TelegramConfig> {
    const current = await this.read()
    if (!current)
      throw new Error(
        `telegram.json could not be read; refusing to save over values that may still be there: ${this.filePath}`
      )
    return this.save({
      botToken: partial.botToken !== undefined ? partial.botToken : current.botToken,
      chatId: partial.chatId !== undefined ? partial.chatId : current.chatId,
      userId: partial.userId !== undefined ? partial.userId : current.userId
    })
  }
}
