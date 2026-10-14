// The session events the Host records in its public event log (plugin Phase 3, events and notifications design N2,
// N3): a session waiting on a person, stopped at a usage limit, or moved to another account. The same three things the
// desktop notifications say, by the same rules (desktopNotifier.ts): input needed is a turn into `waiting` of the one
// attention state (src/core/sessions/attention.ts), never a read of it per event, so subagents finishing under an open
// prompt do not repeat it; a roll's `reattach` is a re-publish, not a new wait or switch.
//
// **Where the signals come from** is the split Slack in the Host uses (slackSources.ts): every hook event of the
// profile (the rolling's hook tap), the chats and chains this Host holds, and the app's `session-signal` for the chats
// and chains only the app holds. A forward for a session the Host sources itself is dropped, so each is recorded once.
//
// **The session is read at the time of recording** (`sessionById`), falling back to what the app forwarded, then to
// its id and kind. The reads are chained, so two events of one session keep their order. Never throws: a failure is
// logged and the next event goes on.
//
// Imports only core modules and this folder: this bundles into the Host.
import { createAttentionState } from '../core/sessions/attention'
import { hookEventPrompt } from '../core/hooks/sessionState'
import { parseSessionSignal, type SignalSession } from '../core/sessions/sessionSignal'
import type { EventDraft } from '../core/orchestration/publicEvents'
import type { HostSession } from '../core/orchestration/command'
import type { ChatEvent } from '../core/chat/types'
import type { EventType } from '../core/publicContract'
import type { Attention, RollStateEvent } from '../core/types'
import type { PtyRegistry } from './registry'
import type { ProcRegistry } from './procRegistry'
import type { HostChats } from './hostChats'
import type { HostRolling } from './rolling'

export interface HostSessionEvents {
  /** Every hook event of the profile (the rolling's hook tap). */
  onHookEvent(sessionId: string, payload: unknown): void
  /** A roll state of a chain this Host holds (the rolling's `onRollEvent`). */
  onRollState(e: RollStateEvent): void
  /** A `session-signal` body from a greeted app. */
  forwarded(raw: unknown): void
  /** Settles once every event noticed so far is recorded. */
  settled(): Promise<void>
  dispose(): void
}

type Prompt = 'permission' | 'question' | null
type ChatSignal = { type: 'status'; status: Attention } | { type: 'request'; request: 'approval' | 'question' | null }

export function createHostSessionEvents(d: {
  record(drafts: EventDraft[]): void
  sessionById(id: string): Promise<HostSession | null>
  registry: Pick<PtyRegistry, 'onExit' | 'metaOf' | 'sessionPty'>
  procs: Pick<ProcRegistry, 'onExit' | 'list'>
  chats: Pick<HostChats, 'subscribe' | 'has'> | null
  rolling: Pick<HostRolling, 'has'> | null
  log(message: string): void
}): HostSessionEvents {
  /** A log line never throws. */
  const log = (m: string): void => {
    try {
      d.log(m)
    } catch {
      /* nowhere to say it */
    }
  }
  const attention = createAttentionState()
  /** What each session would be waiting on, were it to turn to waiting now. */
  const asking = new Map<string, Prompt>()
  /** Sessions with an AskUserQuestion call outstanding: the prompt that comes up for it is a question. */
  const questions = new Set<string>()
  const kinds = new Map<string, SignalSession['kind']>()
  /** The session as an app forwarded it, for a session the Host has no row for. */
  const told = new Map<string, SignalSession>()
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  const sessionOf = async (id: string): Promise<SignalSession> => {
    let found: HostSession | null = null
    try {
      found = await d.sessionById(id)
    } catch (err) {
      log(`session ${id} could not be read: ${String(err)}`)
    }
    const known = found ?? told.get(id) ?? null
    return {
      id,
      kind: known?.kind ?? kinds.get(id) ?? 'terminal',
      ...(known?.title ? { title: known.title } : {}),
      ...(known?.provider ? { provider: known.provider } : {}),
      ...(known?.cwd ? { cwd: known.cwd } : {})
    }
  }

  const record = (sessionId: string, type: EventType, rest: Record<string, unknown>): void => {
    queue = queue.then(async () => {
      const session = await sessionOf(sessionId)
      try {
        d.record([{ type, sessionId, payload: { session, ...rest } }])
      } catch (err) {
        log(`${type} of ${sessionId} could not be recorded: ${String(err)}`)
      }
    })
  }

  attention.subscribe((sessionId, value) => {
    if (value === 'waiting') record(sessionId, 'session.input_needed', { prompt: asking.get(sessionId) ?? null })
  })

  const onChat = (sessionId: string, e: ChatSignal): void => {
    kinds.set(sessionId, 'chat')
    // A chat's adapter emits its request before the status it puts the session in (adapterCore.ts flush), so the
    // prompt is known when the status turns to waiting.
    if (e.type === 'request') asking.set(sessionId, e.request === null ? null : e.request === 'approval' ? 'permission' : 'question')
    else attention.set(sessionId, e.status)
  }

  const onRoll = (e: RollStateEvent): void => {
    if (e.reattach) return
    if (e.state === 'waiting')
      record(e.sessionId, 'session.limit_waiting', { ...(e.scope ? { scope: e.scope } : {}), ...(e.nextRetryAt ? { nextRetryAt: e.nextRetryAt } : {}) })
    else if (e.state === 'switching' && e.accountLabel) record(e.sessionId, 'session.account_switched', { accountLabel: e.accountLabel })
  }

  const ended = (sessionId: string): void => {
    attention.forget(sessionId)
    asking.delete(sessionId)
    questions.delete(sessionId)
    kinds.delete(sessionId)
    told.delete(sessionId)
  }

  const guard = (what: string, fn: () => void): void => {
    if (disposed) return
    try {
      fn()
    } catch (err) {
      log(`${what} failed: ${String(err)}`)
    }
  }

  const offs: Array<() => void> = [
    d.chats?.subscribe((sessionId, e: ChatEvent) =>
      guard('a chat event', () => {
        if (e.type === 'status') onChat(sessionId, { type: 'status', status: e.status })
        else if (e.type === 'request') onChat(sessionId, { type: 'request', request: e.request === null ? null : e.request.kind })
      })
    ) ?? (() => {}),
    d.registry.onExit((ptyId) =>
      guard('an exit', () => {
        const m = d.registry.metaOf(ptyId)
        // A respawn that keeps the id opens the new pty first (rolling.ts's rule): that exit is not its end.
        if (m?.kind === 'session' && d.registry.sessionPty(m.id) === null) ended(m.id)
      })
    ),
    d.procs.onExit((procId) =>
      guard('a chat exit', () => {
        const all = d.procs.list()
        const m = all.find((e) => e.id === procId)?.meta
        if (m?.kind === 'chat' && !all.some((e) => e.alive && e.meta?.kind === 'chat' && e.meta.id === m.id)) ended(m.id)
      })
    )
  ]

  return {
    onHookEvent: (sessionId, payload) =>
      guard('a hook event', () => {
        if (typeof payload !== 'object' || payload === null) return
        const p = payload as { hook_event_name?: unknown; tool_name?: unknown }
        kinds.set(sessionId, 'terminal')
        if (p.hook_event_name === 'PreToolUse' && p.tool_name === 'AskUserQuestion') questions.add(sessionId)
        else if ((p.hook_event_name === 'PostToolUse' && p.tool_name === 'AskUserQuestion') || p.hook_event_name === 'Stop' || p.hook_event_name === 'StopFailure')
          questions.delete(sessionId)
        // Set before attention hears the event: its subscriber, which records, runs inside onHookEvent.
        asking.set(sessionId, questions.has(sessionId) ? 'question' : hookEventPrompt(payload))
        attention.onHookEvent(sessionId, payload)
      }),
    onRollState: (e) => guard('a roll state', () => onRoll(e)),
    forwarded: (raw) =>
      guard('a forwarded signal', () => {
        const s = parseSessionSignal(raw)
        if (s === null) return log(`a malformed session signal was dropped: ${String(JSON.stringify(raw)).slice(0, 200)}`)
        if (s.kind === 'chat') {
          if (d.chats?.has(s.session.id)) return
          told.set(s.session.id, s.session)
          onChat(s.session.id, s.event)
        } else {
          if (d.rolling?.has(s.session.id)) return
          told.set(s.session.id, s.session)
          kinds.set(s.session.id, s.session.kind)
          onRoll(s.event)
        }
      }),
    settled: () => queue,
    dispose() {
      disposed = true
      for (const off of offs) off()
    }
  }
}
