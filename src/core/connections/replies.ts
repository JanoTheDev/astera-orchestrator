// The channel-neutral half of reply intake: once a connection's inbox has decided a message is an allowed
// reply (Slack: core/slack/inbound.ts classifyInbound), this routes it to its session — a terminal
// session's reply is written into its PTY, a chat session's reply answers its open card (a question's
// numbers, an approval's word) or becomes its next turn. When it cannot be delivered, a note goes back
// where the reply came from. The inbox keeps everything about its own socket, ack and reconnect.
import { toSessionInput, buildChoiceKeys, sanitizeChatText, type ChoiceShape } from './input'
import { questionAnswerOf, approvalDecisionOf } from './chatRequest'
import type { ChatRequest, ChatAnswer } from '../chat/types'
import { t, type Lang } from '../i18n'

// Gap between individual choice keys. Same value and same reasoning as ENTER_DELAY_MS. Written glued
// together in one go, the TUI receives them as a clump and they no longer match its digit test
// (`/^[0-9]$/`) — measured proof: sending "1,3" only ever checked item 1.
const KEY_DELAY_MS = 150
const ENTER_DELAY_MS = 150 // text -> Enter gap (same convention as scheduler.ts and claudeCoordinator.ts —
// time for the TUI to digest the paste). Writing the text and Enter in one go can submit before the
// TUI has finished digesting the paste, which can submit empty or truncated input.

/** The ids an inbox has already handled, so a redelivered message (a failed ack) is skipped. Insertion
 *  order is kept, so past `limit` the oldest is dropped first and the set cannot grow forever. */
export class RecentIds {
  private ids = new Set<string>()
  constructor(private readonly limit: number) {}

  has(id: string): boolean {
    return this.ids.has(id)
  }

  add(id: string): void {
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value
      if (oldest !== undefined) this.ids.delete(oldest)
    }
  }
}

export interface ReplyRouterDeps {
  /** The id a reply points at (Slack: its thread ts) -> live session id. null for an exited session
   *  (ConnectionNotifier.resolveSessionByThread) */
  resolveSession(target: string): string | null
  /** PTY write (backed by core.sessions.write). Returns whether it actually wrote —
   *  SessionManager.write returns silently for an already-exited session (its exited guard), so "did
   *  not throw" must not be read as success. The caller checks liveness first and passes the result
   *  through. */
  write(sessionId: string, data: string): boolean
  /** Notice left where the reply came from when the input cannot be injected
   *  (ConnectionNotifier.postThreadNote) */
  postNote(noteTo: string, text: string): Promise<void>
  /** Taken as a getter rather than a value so the latest language is used even after setLang — the same
   *  convention as ConnectionDeps and RollingDeps. The notices above follow the app language. */
  lang: () => Lang
  /** Shape of the choice prompt this session currently has up (ConnectionNotifier.pendingChoiceShape).
   *  null means either it is not a choice prompt or the shape cannot be trusted, and in that case the
   *  text is injected as before. Kept optional so callers without this wiring (tests included) do not
   *  break silently. */
  pendingChoiceShape?(sessionId: string): ChoiceShape[] | null
  /** Whether this id is a chat session — the chat path below is taken only then (core.chat.has). Kept
   *  optional so callers without chat wiring (tests included) keep taking the pty path. */
  isChat?(sessionId: string): boolean
  /** The card the chat session is showing, or null (core.chat.state(id)?.request). */
  pendingRequest?(sessionId: string): ChatRequest | null
  /** One turn to the chat session through the session driver; rejects when the CLI refused it. */
  deliverChat?(sessionId: string, text: string): Promise<void>
  /** The card's answer (core.chat.answer). */
  answerChat?(sessionId: string, requestId: string, answer: ChatAnswer): Promise<void>
  log(message: string): void
}

/** One allowed reply: the id it points at, its text, and where a note about it goes. */
export interface Reply {
  target: string
  text: string
  noteTo: string
}

export class ReplyRouter {
  /** `name` is the connection's, the first word of every log line ('slack'). */
  constructor(
    private deps: ReplyRouterDeps,
    private name: string
  ) {}

  async route(reply: Reply): Promise<void> {
    const { text, noteTo } = reply
    const sessionId = this.deps.resolveSession(reply.target)
    if (!sessionId) {
      this.deps.log(`${this.name} inbound: unmapped thread — exited session`)
      await this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.sessionEnded'))
      return
    }
    if (this.deps.isChat?.(sessionId)) {
      await this.handleChatReply(sessionId, text, noteTo)
      return
    }
    // On a choice prompt, the text is not written as-is but converted into a key sequence. A
    // multi-select is not submitted by Enter alone (it has to go through the Submit tab), so the old
    // path could never finish the answer.
    const shape = this.deps.pendingChoiceShape?.(sessionId) ?? null
    if (shape) {
      const built = buildChoiceKeys(text, shape)
      if (!built.ok) {
        // On a malformed reply, press nothing at all — a wrong sequence commits items nobody meant to
        // pick and cannot be undone. The reason goes into the thread so the user can learn the format
        // and send again.
        // The log records the message key (language-independent, so it stays greppable), while the
        // thread gets the sentence translated into the app language.
        this.deps.log(`${this.name} choice reply format mismatch session=${sessionId}: ${built.reason.key}`)
        const reason = t(this.deps.lang(), built.reason.key, built.reason.params)
        await this.deps.postNote(noteTo, `⚠️ ${reason}`)
        return
      }
      this.deps.log(`${this.name} inbound -> injecting ${built.keys.length} choice keys session=${sessionId}`)
      this.writeKeys(sessionId, built.keys, noteTo)
      return
    }
    const input = toSessionInput(text)
    let wrote = false
    try {
      wrote = this.deps.write(sessionId, input.text)
    } catch (err) {
      // The user needs to know about an injection failure — on a phone there is no terminal to look at
      this.deps.log(`${this.name} injection failed(${err instanceof Error ? err.name : 'unknown'}) session=${sessionId}`)
      await this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.injectFailed'))
      return
    }
    if (!wrote) {
      // write returned false — SessionManager.write's exited guard swallowed it silently.
      // Reporting "did not throw" as success would leave the user with no notice in the thread at all.
      this.deps.log(`${this.name} inbound: session exited — could not inject session=${sessionId}`)
      await this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.sessionEnded'))
      return
    }
    this.deps.log(`${this.name} inbound -> injected into session=${sessionId} chars=${text.length}`)
    if (input.submit) {
      // The text and Enter are not written in one go — this follows the ENTER_DELAY_MS convention
      // from scheduler.ts and claudeCoordinator.ts. If the session dies during the delay, deps.write returns
      // false on its own and writes nothing — write()'s contract is to re-check liveness on every
      // call, so there is no need for a separate disposed flag here (see the ReplyRouterDeps.write
      // contract above).
      setTimeout(() => {
        try {
          this.deps.write(sessionId, '\r')
        } catch (err) {
          this.deps.log(
            `${this.name} injection Enter failed(${err instanceof Error ? err.name : 'unknown'}) session=${sessionId}`
          )
        }
      }, ENTER_DELAY_MS)
    }
  }

  /**
   * Sends the choice keys one at a time, KEY_DELAY_MS apart.
   *
   * Written glued together in one go, the TUI receives them as a clump and they no longer match its
   * digit test (the measurement in the KEY_DELAY_MS comment). If the session dies partway, write
   * returns false and we stop right there — no separate disposed flag is needed (the
   * ReplyRouterDeps.write contract). If it ends half-pressed the prompt stays on screen, and the user
   * can read the thread notice and finish up in the terminal.
   */
  private writeKeys(sessionId: string, keys: string[], noteTo: string): void {
    let i = 0
    const step = (): void => {
      if (i >= keys.length) return
      let ok = false
      try {
        ok = this.deps.write(sessionId, keys[i])
      } catch (err) {
        this.deps.log(
          `${this.name} choice key failed(${err instanceof Error ? err.name : 'unknown'}) session=${sessionId} at=${i + 1}/${keys.length}`
        )
        void this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.injectFailed'))
        return
      }
      if (!ok) {
        this.deps.log(
          `${this.name} session exited mid choice keys session=${sessionId} at=${i + 1}/${keys.length}`
        )
        void this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.sessionEnded'))
        return
      }
      i++
      if (i < keys.length) setTimeout(step, KEY_DELAY_MS)
    }
    step()
  }

  /** A reply for a chat session (chat-sessions slice 4 design §7.3). The session holds its own open
   *  card, so the reply is read against it: a question's numbers become its answers, an approval's word
   *  its decision, and with no card the text is one turn through the session driver. Nothing is typed —
   *  there is no terminal — and nothing is posted on success: a resolved send on Claude means "written",
   *  not "accepted" (§6.5), so only refusals are said out loud. */
  private async handleChatReply(sessionId: string, text: string, noteTo: string): Promise<void> {
    const lang = this.deps.lang()
    const request = this.deps.pendingRequest?.(sessionId) ?? null
    if (request?.kind === 'question') {
      const built = questionAnswerOf(text, request.form)
      if (!built.ok) {
        this.deps.log(`${this.name} chat question reply format mismatch session=${sessionId}: ${built.reason.key}`)
        await this.deps.postNote(noteTo, `⚠️ ${t(lang, built.reason.key, built.reason.params)}`)
        return
      }
      this.deps.log(`${this.name} inbound -> answering question ${request.id} session=${sessionId}`)
      await this.answerOrNote(sessionId, request.id, { kind: 'question', answers: built.answers }, noteTo)
      return
    }
    if (request?.kind === 'approval') {
      const decision = approvalDecisionOf(text, request.decisions)
      if (decision === null) {
        this.deps.log(`${this.name} chat approval reply not understood session=${sessionId}`)
        const key = request.decisions.includes('acceptForSession') ? 'slack.approval.unknownReplyAlways' : 'slack.approval.unknownReply'
        await this.deps.postNote(noteTo, t(lang, key))
        return
      }
      this.deps.log(`${this.name} inbound -> deciding approval ${request.id} (${decision}) session=${sessionId}`)
      await this.answerOrNote(sessionId, request.id, { kind: 'approval', decision }, noteTo)
      return
    }
    try {
      await this.deps.deliverChat?.(sessionId, sanitizeChatText(text))
      this.deps.log(`${this.name} inbound -> chat turn session=${sessionId} chars=${text.length}`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.deps.log(`${this.name} chat send refused session=${sessionId}: ${reason}`)
      await this.deps.postNote(noteTo, t(lang, 'slack.chat.sendRefused', { reason }))
    }
  }

  private async answerOrNote(sessionId: string, requestId: string, answer: ChatAnswer, noteTo: string): Promise<void> {
    try {
      await this.deps.answerChat?.(sessionId, requestId, answer)
    } catch (err) {
      this.deps.log(`${this.name} chat answer failed session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`)
      await this.deps.postNote(noteTo, t(this.deps.lang(), 'slack.inbox.injectFailed'))
    }
  }
}
