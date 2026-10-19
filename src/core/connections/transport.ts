// The contract every connection's transport implements: "where the text goes and how", and nothing about
// what the text says (that is notifier.ts). Slack's webhook and bot transports live in core/slack/transport.ts.
// Each transport renders the notifier's plain text for its own channel: Slack passes it through unchanged,
// a channel with its own markup (Telegram's HTML) escapes and converts it there.
// Tokens, webhook URLs and chat credentials never make it into a log or an error.

/** A post failure. reason goes into the log verbatim, so it may only carry values that cannot contain a URL or token. */
export class ConnectionPostError extends Error {
  constructor(readonly reason: string) {
    super(`post failed ${reason}`)
    this.name = 'ConnectionPostError'
  }
}

export interface ConnectionTransport {
  /** On success the posted message's id (usable as a thread root), or null when unsupported. Failure throws
   *  ConnectionPostError. */
  post(text: string, threadId?: string): Promise<string | null>
  readonly supportsThreads: boolean
}
