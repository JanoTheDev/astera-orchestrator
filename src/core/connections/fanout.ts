// Every connection's notifier behind one object: each input a caller has for "the notifier" goes to every
// connection in the list, in order, and a throw in one never keeps the next from hearing it. With one
// connection (Slack) it is that notifier. How to add a connection is in notifier.ts's header: its own
// ConnectionNotifier joins this list.
import type { RollStateEvent, SessionInfo } from '../types'
import type { ChatEvent } from '../chat/types'
import type { Provider } from '../providers/meta'
import type { ConnectionNotifier } from './notifier'

export class ConnectionFanout {
  constructor(
    private readonly notifiers: readonly ConnectionNotifier[],
    private readonly log: (message: string) => void = () => {}
  ) {}

  private each(what: string, fn: (n: ConnectionNotifier) => void): void {
    for (const n of this.notifiers) {
      try {
        fn(n)
      } catch (err) {
        this.log(`connections: ${what} failed(${err instanceof Error ? err.name : 'unknown'})`)
      }
    }
  }

  /** Each connection reads its own thread out of the session's note (its own keys). */
  register(info: SessionInfo, note?: Record<string, unknown>): void {
    this.each('register', (n) => n.register(info, { thread: note ? n.notedThreadOf(note) : null }))
  }

  /** Whether any connection holds a record for the session. */
  has(sessionId: string): boolean {
    return this.notifiers.some((n) => n.has(sessionId))
  }

  adoptNoted(sessionId: string, note: Record<string, unknown>): void {
    this.each('adoptNoted', (n) => n.adoptNoted(sessionId, n.notedThreadOf(note)))
  }

  rename(sessionId: string, title: string): void {
    this.each('rename', (n) => n.rename(sessionId, title))
  }

  onHookEvent(sessionId: string, payload: unknown): void {
    this.each('onHookEvent', (n) => n.onHookEvent(sessionId, payload))
  }

  onChatEvent(sessionId: string, event: ChatEvent, at: { provider: Provider; transcriptPath: () => string | null }): void {
    this.each('onChatEvent', (n) => n.onChatEvent(sessionId, event, at))
  }

  onCodexTurnComplete(sessionId: string, rolloutPath: string): void {
    this.each('onCodexTurnComplete', (n) => n.onCodexTurnComplete(sessionId, rolloutPath))
  }

  onRollState(ev: RollStateEvent): void {
    this.each('onRollState', (n) => n.onRollState(ev))
  }

  onRolled(oldSessionId: string, info: SessionInfo): void {
    this.each('onRolled', (n) => n.onRolled(oldSessionId, info))
  }

  handleData(e: { sessionId: string; data: string }): void {
    this.each('handleData', (n) => n.handleData(e))
  }

  handleExit(e: { sessionId: string; exitCode: number }): void {
    this.each('handleExit', (n) => n.handleExit(e))
  }

  /** True when any connection posted it. */
  async postNotice(text: string): Promise<boolean> {
    const posted = await Promise.all(this.notifiers.map((n) => n.postNotice(text).catch(() => false)))
    return posted.includes(true)
  }

  /** True when any connection posted it (or holds it as just posted); rejects when a connection that
   *  holds the session could not post it yet, so the caller retries, as with one notifier. */
  async announceOffline(sessionId: string, text: string): Promise<boolean> {
    const results = await Promise.allSettled(this.notifiers.map((n) => n.announceOffline(sessionId, text)))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    return results.some((r) => r.status === 'fulfilled' && r.value)
  }

  /** Called when any connection's transport becomes able to post. Returns the unsubscribe. */
  onTransportReady(fn: () => void): () => void {
    const offs = this.notifiers.map((n) => n.onTransportReady(fn))
    return () => offs.forEach((off) => off())
  }
}
