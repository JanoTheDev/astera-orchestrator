// The channel-neutral half of turning a reply into session input: what gets written to a PTY, a chat
// turn's text, and a choice prompt's key sequence. Every connection's inbox reaches these through
// replies.ts once it has decided a message is an allowed reply; deciding that is the connection's own
// job (Slack: core/slack/inbound.ts classifyInbound).
import type { Message } from '../i18n'

/** The maximum length of a reply injected at once. A Slack message body itself allows up to ~40,000
 *  characters, but a reply is a path meant for commands and prompt text, not for bulk pasting.
 *  A reply over the limit is rejected rather than truncated and sent — a truncated command turning into
 *  a different (yet plausible) command than the one intended is the more dangerous outcome (the same
 *  reasoning as "removing is safer than escaping" in commands.ts sanitizeResumePrompt). */
export const MAX_INJECT_CHARS = 4000

/** The result of converting reply text into the form to write to the PTY. Enter (submit) itself is not
 *  part of text — by the same convention as scheduler.ts and claudeCoordinator.ts, SlackInbox has to send it
 *  separately ENTER_DELAY_MS (150ms) after writing the text so the TUI has digested the whole paste
 *  before it submits. */
export interface SessionInput {
  /** The body to write to the PTY — newlines are already folded into Alt+Enter (ESC+CR). */
  text: string
  /** When true, Enter has to be sent separately after writing text in order to submit. Every path where
   *  classifyInbound returns inject intends a submit, so it is always true for now, but making the caller
   *  check the value explicitly keeps it from breaking silently if the value ever changes (pure typing
   *  with no submit, for instance). */
  submit: boolean
}

/** What gets stripped: C0 control characters (0x00-0x1F) and DEL (0x7F) — only the newlines
 *  (\n=0x0A, \r=0x0D) are kept as exceptions. Those two are the newlines we intend, converted to
 *  Alt+Enter below. The rest are bytes that cannot be typed into a text field from a keyboard —
 *  Ctrl+C (\x03, interrupt the turn), Ctrl+D (\x04, end the session), ESC (\x1b, start of an ANSI
 *  sequence) and so on. The same reasoning as sanitizeResumePrompt in commands.ts: removing is safer
 *  than implementing perfect escaping. */
const CONTROL_CHARS_EXCEPT_NEWLINE = /[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g

/**
 * Converts reply text into the bytes to write to the PTY.
 *
 * Sending newlines as they are makes the CLI take every line as a submit and start several turns. By
 * the same rule as TerminalView's Ctrl+Enter handling, an Alt+Enter sequence (ESC+CR) is sent so only a
 * newline is inserted. CRLF and a bare CR are folded the same way — Slack sends LF, but depending on
 * the client they can be mixed in.
 */
export function toSessionInput(text: string): SessionInput {
  const safe = text.replace(CONTROL_CHARS_EXCEPT_NEWLINE, '')
  return { text: safe.replace(/\r\n|\r|\n/g, '\x1b\r'), submit: true }
}

/** A chat turn's text from a reply. Control characters go (the same set toSessionInput strips), but
 *  newlines stay: a chat turn is a JSON string, not keys typed into a TUI, so there is nothing to fold. */
export function sanitizeChatText(text: string): string {
  return text.replace(CONTROL_CHARS_EXCEPT_NEWLINE, '')
}

/** The shape of one choice screen — whether each question is multi-select, and how many items can be
 *  picked by number */
export interface ChoiceShape {
  multiSelect: boolean
  /** The number of options AskUserQuestion gave. The automatically appended 'Other' is excluded — it is
   *  type:"input", so picking it by number enters free-input mode, and in that state number keys are
   *  ignored (measured in Claude Code). */
  optionCount: number
}

/** The failure reason is a `Message`, not a sentence — this module is core and does not know the
 *  language, so main (slackInbox) translates it before posting it into the thread. That is the same
 *  layering convention the file-operation errors follow. */
export type ChoiceKeysResult = { ok: true; keys: string[] } | { ok: false; reason: Message }

/**
 * Turns a reply to a choice prompt into an auto-submit key sequence.
 *
 * The format separates questions with `/` and multiple choices within one question with `,` —
 * `"1,3 / 2"`. Newlines are not used as a separator because that would collide in meaning with the
 * existing path where toSessionInput folds newlines into Alt+Enter.
 *
 * The key sequence was settled by reading the Claude Code TUI's key handling:
 *  - A number key **toggles** the item with that number (focus does not move).
 *  - Tab moves to the next question's tab, and on the last question to the `✓ Submit` tab.
 *  - On the Submit tab, Enter submits. A multi-select is not submitted by Enter alone (the
 *    `!isMultiSelect && return → onSubmit` path, which exists only for single-select, is closed).
 *  - **A single-select advances to the next question on its own once an answer is picked, through the
 *    `shouldAdvance` default.** So putting a Tab after a single-select overshoots by one — Tab is
 *    attached to multi-selects only.
 *  - The reducer that increments the question index has no upper bound (`currentQuestionIndex + 1`, no
 *    Math.min). That is why sending Tab generously is not safe, and why exactly one is counted per
 *    question.
 *
 * If the format is off, nothing is injected and the reason is returned. A wrongly sent sequence commits
 * items that were not intended and cannot be undone, so when it is ambiguous, pressing nothing is the
 * right call (the same rule as answerLimitChoice in claudeCoordinator.ts).
 */
export function buildChoiceKeys(text: string, shape: ChoiceShape[]): ChoiceKeysResult {
  if (shape.length === 0) return { ok: false, reason: { key: 'slack.choice.noShape' } }
  const parts = text
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (parts.length !== shape.length)
    return {
      ok: false,
      reason: {
        key: 'slack.choice.countMismatch',
        params: { expected: shape.length, got: parts.length }
      }
    }
  const keys: string[] = []
  for (let i = 0; i < shape.length; i++) {
    const nums = parts[i].match(/\d+/g) ?? []
    // With more than one question the reason has to say which one, so the *At variant of each key is
    // used and carries the 1-based index.
    const at = shape.length > 1 ? { index: i + 1 } : null
    if (nums.length === 0)
      return {
        ok: false,
        reason: at
          ? { key: 'slack.choice.noNumberAt', params: at }
          : { key: 'slack.choice.noNumber' }
      }
    if (!shape[i].multiSelect && nums.length > 1)
      return {
        ok: false,
        reason: at
          ? { key: 'slack.choice.singleOnlyAt', params: at }
          : { key: 'slack.choice.singleOnly' }
      }
    for (const raw of nums) {
      const n = Number(raw)
      // There are at most 4 items (the AskUserQuestion schema is min(2).max(4)), so a number is always a
      // single digit. Two or more digits cannot be sent as one key and are out of range to begin with —
      // the upper-bound check below filters them out along the way.
      if (n < 1 || n > shape[i].optionCount)
        return {
          ok: false,
          reason: at
            ? {
                key: 'slack.choice.outOfRangeAt',
                params: { ...at, n: raw, max: shape[i].optionCount }
              }
            : { key: 'slack.choice.outOfRange', params: { n: raw, max: shape[i].optionCount } }
        }
      keys.push(String(n))
    }
    if (shape[i].multiSelect) keys.push('\t')
  }
  keys.push('\r')
  return { ok: true, keys }
}
