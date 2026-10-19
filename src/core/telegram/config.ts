// The read-only half of telegram.json settings storage, mirroring core/slack/config.ts: the Host reads it
// through TelegramConfigReader, the app's writer (TelegramConfigStore, main/telegramConfigStore.ts) extends it.
import { promises as fs } from 'node:fs'
import { norm } from '../connections/norm'

export interface TelegramConfig {
  botToken: string | null // from @BotFather
  chatId: string | null // the chat session messages are posted to (your own numeric id for a private chat)
  // The one Telegram user id whose replies are injected into sessions. Receiving-side permission only: sending
  // keeps working without it while every reply is blocked. A missing value blocks everyone rather than allowing
  // everyone, so a telegram.json with no such field converges on the safe side with no migration.
  userId: string | null
}

export const EMPTY_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: null,
  chatId: null,
  userId: null
}

/** Settings storage (<profile>/telegram.json). A missing or corrupt file falls back to defaults — it does not
 *  block the app. The bot token never leaves this file: it is not put in logs or error messages. */
// The file is the only copy of the credentials, so the read paths distinguish "nothing stored" from
// "could not be read" — see read() for why, and patch() (in TelegramConfigStore) for what depends on it.
export class TelegramConfigReader {
  constructor(protected readonly filePath: string) {}

  /** The stored values, or null when the file is there but could not be read — not the same as "nothing is
   *  stored". A missing file (ENOENT) is a fresh install and gives defaults; an unparseable file gives defaults
   *  too, because that damage does not heal on a retry and the settings screen has to stay able to overwrite
   *  it. Anything else (EPERM, EBUSY, EMFILE …) is transient, and the values it hides are still on disk. */
  protected async read(): Promise<TelegramConfig | null> {
    let text: string
    try {
      text = await fs.readFile(this.filePath, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_TELEGRAM_CONFIG }
      return null
    }
    try {
      const raw = JSON.parse(text) as Record<string, unknown>
      return { botToken: norm(raw.botToken), chatId: norm(raw.chatId), userId: norm(raw.userId) }
    } catch {
      return { ...EMPTY_TELEGRAM_CONFIG }
    }
  }

  /** Reading is deliberately forgiving: an unreadable file leaves Telegram looking unconfigured rather than
   *  keeping the app from starting. Writers must not inherit that — see TelegramConfigStore.patch(). */
  async load(): Promise<TelegramConfig> {
    return (await this.read()) ?? { ...EMPTY_TELEGRAM_CONFIG }
  }
}
