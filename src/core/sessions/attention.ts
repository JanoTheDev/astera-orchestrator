import {
  isIdleNotification,
  isNonPromptNotification,
  type NotificationPayload
} from '../hooks/notification'
import { happenedBefore, hookEventAt } from '../hooks/eventTime'
import type { Attention } from '../types'

/** Where a session stands right now, from the app's own point of view rather than the transcript's —
 *  the transcript stays frozen while a permission prompt sits on screen (measured in the countToolUses
 *  comment in core/connections/transcript.ts), so there is nothing there to read this off.
 *
 *  Declared in core/types.ts because it crosses IPC and the renderer has to name it, and re-exported
 *  here so this module's own consumers keep importing it from the module that produces it. One
 *  declaration, not two kept in step by hand.
 *
 *  In core since plugin Phase 3 (events and notifications design N3): the Host builds one too, from
 *  its rolling's hook tap (src/host/sessionEvents.ts), so "waiting for input" is decided by this one
 *  rule in both processes. */
export type { Attention }

/** How long a session reads `working` with no sign of life: no output from its pty and no turn or
 *  tool call started inside the window. Past it, a turn nobody ended (Esc fires no Stop) reads `idle`. */
export const WORKING_DECAY_MS = 10 * 60_000

/** After person input, how long a turn keeps reading `working` without new pty output. Claude Code
 *  redraws its spinner many times a second while it thinks or runs a tool, so typing the next message
 *  mid-turn keeps it `working`; Esc stops the spinner, and the turn reads `idle` once this has passed. */
export const INPUT_QUIET_MS = 5_000

/** The one rule for "is this session really working", shared by the app (`createAttentionState`) and
 *  the Host (`sessionStateOf`, core/hooks/sessionState.ts) so `astera sessions list` and the tiles
 *  agree. Working only if a turn or tool call is open, the process lives, and something happened within
 *  the decay window. Person input after the last hook event (a tie counts as after: the two cannot be
 *  ordered) may have been an Esc that ended the turn, so from then on only fresh pty output
 *  (INPUT_QUIET_MS) keeps it working. `now` null skips the clock: then input after the event ends it. */
export function isWorking(a: {
  open: boolean
  exited: boolean
  eventAt: number | null
  personInputAt: number | null
  lastOutputAt: number | null
  startedAt: number | null
  now: number | null
}): boolean {
  if (a.exited || !a.open) return false
  const inputAfter = a.personInputAt !== null && (a.eventAt === null || a.personInputAt >= a.eventAt)
  if (a.now === null) return !inputAfter
  const fresh = (t: number | null, window: number): boolean => t !== null && a.now! - t < window
  if (inputAfter) return fresh(a.lastOutputAt, INPUT_QUIET_MS)
  return fresh(a.lastOutputAt, WORKING_DECAY_MS) || fresh(a.startedAt, WORKING_DECAY_MS)
}

export interface AttentionState {
  /** One hook event for one session. The payload is the raw hook payload, exactly as the existing
   *  taps receive it, so this can be added to the same fan-out without reshaping anything:
   *  `HookEventWatcher` in `src/main/index.ts` already calls `slack.onHookEvent(sid, payload)`,
   *  `rolling.onHookEvent(sid, payload)` and `desktop.onHookEvent(sid, payload)` with this shape.
   *  Read `hook_event_name` off it yourself; it is `unknown` because the watcher does not validate.
   *  The name matches the three existing taps on purpose, so the fan-out reads the same for all. */
  onHookEvent(sessionId: string, payload: unknown): void
  /** Writes a session's value outright, with none of `onHookEvent`'s bookkeeping — no `outstanding`
   *  set is touched, because the caller already knows the answer. This is how a chat session's
   *  attention is fed (chat-sessions design §6): its adapter reports a status directly, so there is
   *  no hook stream to infer one from. Fires subscribers only when the value actually changes, the
   *  same rule every other write here follows. */
  set(sessionId: string, value: Attention): void
  /** A person typed into the session (terminal reports left out). A turn the person interrupted with
   *  Esc fires no hook, so this is what ends its `working`. */
  noteInput(sessionId: string, at: number): void
  /** The pty produced output. Keeps a long quiet-but-alive tool call `working` for the decay window. */
  noteOutput(sessionId: string, at: number): void
  /** Re-reads every `working` session against the clock, so the decay shows without a new event.
   *  `isExited` says which sessions' processes are gone; those are never `working`. */
  recheck(isExited?: (sessionId: string) => boolean): void
  /** The session ended; forget it. */
  forget(sessionId: string): void
  get(sessionId: string): Attention
  /** Fires only when a session's value actually changes. Returns an unsubscribe. */
  subscribe(fn: (sessionId: string, value: Attention) => void): () => void
}

/** One session's bookkeeping. `outstanding` holds the `tool_use_id` of every `PreToolUse` call that
 *  has not yet seen its matching `PostToolUse` — a set rather than a count or a flag because Claude
 *  Code issues calls in batches: two `PreToolUse` events can arrive before either call's
 *  `PostToolUse`, and a flag would clear on the first return while the second call is still running. */
interface SessionAttention {
  value: Attention
  outstanding: Set<string>
  /** A turn is running: from its UserPromptSubmit (or a tool call, for a turn whose prompt was not
   *  seen) until its Stop. Most sessions hook tool calls only for AskUserQuestion, so a turn that thinks
   *  or runs Bash has no outstanding call to show it (statusline.ts `everySessionHooks`). */
  turnOpen: boolean
  /** When the latest UserPromptSubmit seen for this session happened (its capture's stamp), or null
   *  before one with a stamp. A turn end older than this belongs to the turn before it. */
  promptAt: number | null
  /** When the latest turn end (Stop, StopFailure) happened, or null. A prompt older than this is
   *  the turn that already ended, landing late. */
  endedAt: number | null
  /** When the last hook event happened (its stamp, else when it landed), what person input is ordered against. */
  eventAt: number | null
  personInputAt: number | null
  lastOutputAt: number | null
  /** When the latest turn or tool call started. */
  startedAt: number | null
}

export function createAttentionState(now: () => number = Date.now): AttentionState {
  const sessions = new Map<string, SessionAttention>()
  const listeners = new Set<(sessionId: string, value: Attention) => void>()

  function recordFor(sessionId: string): SessionAttention {
    let record = sessions.get(sessionId)
    if (!record) {
      record = { value: 'idle', outstanding: new Set(), turnOpen: false, promptAt: null, endedAt: null, eventAt: null, personInputAt: null, lastOutputAt: null, startedAt: null }
      sessions.set(sessionId, record)
    }
    return record
  }

  function setValue(sessionId: string, record: SessionAttention, next: Attention): void {
    if (record.value === next) return
    record.value = next
    for (const fn of listeners) fn(sessionId, next)
  }

  /** A `working` that the shared rule no longer holds up reads idle, and its stale calls are dropped. */
  function revalidate(sessionId: string, record: SessionAttention, exited = false): void {
    if (record.value !== 'working') return
    const working = isWorking({ open: record.turnOpen || record.outstanding.size > 0, exited, ...record, now: now() })
    if (working) return
    record.turnOpen = false
    record.outstanding.clear()
    setValue(sessionId, record, 'idle')
  }

  return {
    onHookEvent(sessionId, payload) {
      if (typeof payload !== 'object' || payload === null) return
      const p = payload as { hook_event_name?: unknown; tool_use_id?: unknown } & NotificationPayload
      const eventAt = hookEventAt(p) ?? now()
      if (sessions.has(sessionId)) sessions.get(sessionId)!.eventAt = eventAt

      if (p.hook_event_name === 'UserPromptSubmit') {
        // A turn starts: `working` until its Stop, thinking or not. When it happened is kept too, so a
        // turn end that lands after it but happened before it is known for the previous turn's. A
        // prompt that happened before the latest turn end is that ended turn landing late (async).
        const at = hookEventAt(p)
        const record = recordFor(sessionId)
        record.eventAt = eventAt
        if (at !== null && !happenedBefore(at, record.promptAt)) record.promptAt = at
        if (happenedBefore(at, record.endedAt)) return
        record.turnOpen = true
        record.startedAt = eventAt
        // A waiting screen stays up until its call returns or the turn ends.
        if (record.value === 'idle') setValue(sessionId, record, 'working')
      } else if (p.hook_event_name === 'PreToolUse') {
        const record = recordFor(sessionId)
        record.eventAt = eventAt
        record.startedAt = eventAt
        record.turnOpen = true
        if (typeof p.tool_use_id === 'string') record.outstanding.add(p.tool_use_id)
        setValue(sessionId, record, 'working')
      } else if (p.hook_event_name === 'PostToolUse' || p.hook_event_name === 'PostToolUseFailure') {
        // A PostToolUse for a session this state never saw a PreToolUse from has nothing to clear —
        // reading idle by default already gives the right answer, so no entry is created for it.
        const record = sessions.get(sessionId)
        if (!record) return
        if (typeof p.tool_use_id === 'string') record.outstanding.delete(p.tool_use_id)
        // This is also how a `waiting` session leaves that value: answering the prompt is what lets
        // the call proceed, and this is the first evidence that happened, so the same branch that
        // resolves an ordinary call also resolves a waiting one. The turn goes on after its call.
        setValue(sessionId, record, record.turnOpen || record.outstanding.size > 0 ? 'working' : 'idle')
      } else if (p.hook_event_name === 'Notification') {
        // A report of something that already happened is never a waiting screen, regardless of
        // anything else about the session.
        if (isNonPromptNotification(p)) return
        if (isIdleNotification(p)) {
          // The two existing notifiers disagree here, and the disagreement is deliberate on both
          // sides. desktopNotifier drops an idle notice unconditionally — it keeps no per-session
          // capture and needs none. slack.ts also drops it, except when that session has a
          // `pendingTool` captured from PreToolUse still open, because it can afford the extra
          // exception: its sessions carry that capture, so it can tell an idle notice arriving while
          // a call is outstanding apart from one arriving with nothing pending. That is the CLI
          // reporting "waiting for your input" while a tool call sits unanswered — a prompt on
          // screen, not an idle box. This state already tracks outstanding calls by id (see
          // `outstanding` above), so it follows Slack's better-informed rule instead of the simpler
          // one: idle with a call outstanding is `waiting`; idle with none leaves the value as it is.
          const record = sessions.get(sessionId)
          if (!record || record.outstanding.size === 0) return
          setValue(sessionId, record, 'waiting')
          return
        }
        // Everything else — including a notification_type nobody has seen before — is a waiting
        // screen: the same call notification.ts makes for the notifier, because a missed waiting
        // screen strands a session with nobody knowing while a surplus one only costs a glance.
        setValue(sessionId, recordFor(sessionId), 'waiting')
      } else if (p.hook_event_name === 'Stop' || p.hook_event_name === 'StopFailure') {
        // StopFailure is the other way a turn ends: Claude Code fires it *instead of* Stop when an
        // API error (a limit, an auth failure, an overload) ends the turn. The turn is over either
        // way, and leaving the value standing would keep a `waiting` up with nobody waiting, so the
        // next real prompt would be no transition and the desktop notifier would miss it.
        // **StopFailure is captured async (statusline.ts), and so is UserPromptSubmit, so they can
        // land out of order.** A prompt sent right after the failed turn (typed, or queued and sent
        // at once) can have its UserPromptSubmit land first, and the StopFailure after the new
        // turn's first PreToolUse; taken as it lands, it would end the new turn early: idle while it
        // works, and pendingPrompt and Slack would drop its question capture. The capture stamps
        // when it started (core/hooks/eventTime.ts), so a turn end that happened before the latest
        // prompt is the previous turn's and is passed by here. Lines without the stamp, and a tie,
        // keep the order they landed in. Stop is synchronous and cannot land late, but the same
        // rule holds for it. What a late turn end leaves behind is only what the previous turn left:
        // the rare call that never got its PostToolUse (a denied one) stays in `outstanding` until
        // the new turn's own end, as it did before StopFailure was read at all.
        // A stray Stop for a session never seen is already idle by default; only touch an existing
        // record, for the same reason as PostToolUse above.
        const record = sessions.get(sessionId)
        if (!record) return
        const at = hookEventAt(p)
        if (happenedBefore(at, record.promptAt)) return
        if (at !== null) record.endedAt = at
        record.turnOpen = false
        record.outstanding.clear()
        setValue(sessionId, record, 'idle')
      }
    },
    noteInput(sessionId, at) {
      const record = sessions.get(sessionId)
      if (!record) return
      record.personInputAt = at
      revalidate(sessionId, record)
    },
    noteOutput(sessionId, at) {
      const record = sessions.get(sessionId)
      if (record) record.lastOutputAt = at
    },
    recheck(isExited) {
      for (const [id, record] of sessions) revalidate(id, record, isExited?.(id) === true)
    },
    set(sessionId, value) {
      setValue(sessionId, recordFor(sessionId), value)
    },
    forget(sessionId) {
      sessions.delete(sessionId)
    },
    get(sessionId) {
      return sessions.get(sessionId)?.value ?? 'idle'
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
