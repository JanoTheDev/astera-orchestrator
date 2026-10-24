import { describe, it, expect } from 'vitest'
import { createAttentionState, isWorking, INPUT_QUIET_MS, type Attention } from './attention'
import { sessionStateOf } from '../hooks/sessionState'

const pre = (toolUseId: string): unknown => ({ hook_event_name: 'PreToolUse', tool_use_id: toolUseId })
const post = (toolUseId: string): unknown => ({ hook_event_name: 'PostToolUse', tool_use_id: toolUseId })
const notify = (notification_type: string): unknown => ({
  hook_event_name: 'Notification',
  notification_type
})
const stop = (): unknown => ({ hook_event_name: 'Stop' })

describe('createAttentionState — reading', () => {
  it('a fresh state reads idle for any session id', () => {
    const state = createAttentionState()
    expect(state.get('never-seen')).toBe('idle')
  })

  it('two sessions do not see each other’s state', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    expect(state.get('s1')).toBe('working')
    expect(state.get('s2')).toBe('idle')
  })
})

describe('createAttentionState — PreToolUse / PostToolUse', () => {
  // The turn goes on after its call returns (the model reads the result and thinks); only Stop ends it.
  it('PreToolUse moves a session to working; it stays working past the PostToolUse until Stop', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    expect(state.get('s1')).toBe('working')
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('working')
    state.onHookEvent('s1', stop())
    expect(state.get('s1')).toBe('idle')
  })

  // This is the case a boolean gets wrong: calls are issued in batches, so a second PreToolUse can
  // land before either call's PostToolUse. The session must stay working until both are done.
  it('two outstanding calls stay working until both finish', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', pre('call-2'))
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('working')
    state.onHookEvent('s1', notify('idle_prompt'))
    // call-2 still outstanding: an idle notice now is a prompt on screen
    expect(state.get('s1')).toBe('waiting')
    state.onHookEvent('s1', post('call-2'))
    expect(state.get('s1')).toBe('working')
  })
})

describe('createAttentionState — a turn with no tool call', () => {
  // Most sessions hook tool calls only for AskUserQuestion (statusline.ts everySessionHooks), so a turn
  // that thinks, reads files or runs Bash fires UserPromptSubmit and then nothing until Stop.
  it('UserPromptSubmit opens the turn: working while it thinks, idle at Stop', () => {
    const state = createAttentionState(() => 2_000)
    state.onHookEvent('s1', { hook_event_name: 'UserPromptSubmit', prompt: 'go', astera_at: 1_000 })
    expect(state.get('s1')).toBe('working')
    state.recheck()
    expect(state.get('s1')).toBe('working')
    state.onHookEvent('s1', { hook_event_name: 'Stop', astera_at: 9_000 })
    expect(state.get('s1')).toBe('idle')
  })

  it('a prompt that lands after its own turn already ended does not reopen it', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', { hook_event_name: 'PreToolUse', tool_use_id: 'call-1', astera_at: 900 })
    state.onHookEvent('s1', { hook_event_name: 'Stop', astera_at: 1_005 })
    state.onHookEvent('s1', { hook_event_name: 'UserPromptSubmit', prompt: 'go', astera_at: 1_000 })
    expect(state.get('s1')).toBe('idle')
  })
})

describe('createAttentionState — Notification', () => {
  it.each(['permission_prompt', 'worker_permission_prompt', 'agent_needs_input', 'elicitation_dialog'])(
    '%s is a waiting screen',
    (notification_type) => {
      const state = createAttentionState()
      state.onHookEvent('s1', notify(notification_type))
      expect(state.get('s1')).toBe('waiting')
    }
  )

  it.each(['agent_completed', 'auth_success', 'computer_use_exit', 'push_notification'])(
    '%s reports something already finished, not a waiting screen',
    (notification_type) => {
      const state = createAttentionState()
      state.onHookEvent('s1', notify(notification_type))
      expect(state.get('s1')).not.toBe('waiting')
    }
  )

  it('idle_prompt alone is not a waiting screen', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', notify('idle_prompt'))
    expect(state.get('s1')).toBe('idle')
  })

  // A type absent from notification.ts's measured list is deliberately treated as waiting, the same
  // direction notification.ts takes for the notifier: a missed waiting screen strands a session with
  // nobody knowing, while a surplus one only costs a glance.
  it('an unrecognised notification_type is treated as waiting', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', notify('some_future_prompt'))
    expect(state.get('s1')).toBe('waiting')
  })

  // slack.ts keeps an exception desktopNotifier does not: an idle notice arriving while a
  // PreToolUse call is still outstanding is the CLI reporting "waiting for your input" with a call
  // unanswered underneath it — a prompt on screen, not a genuinely idle box. This state tracks
  // outstanding calls by id already, so it follows Slack's rule.
  it('idle_prompt with a call outstanding is a waiting screen', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', notify('idle_prompt'))
    expect(state.get('s1')).toBe('waiting')
  })

  it('idle_prompt with no call outstanding still leaves the value as it is', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', notify('idle_prompt'))
    expect(state.get('s1')).toBe('idle')
  })

  it('idle_prompt with a call outstanding goes to waiting, then back to working once the call finishes', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', notify('idle_prompt'))
    expect(state.get('s1')).toBe('waiting')
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('working')
  })
})

describe('createAttentionState — leaving waiting', () => {
  it('a waiting session returns to working once its only outstanding call finishes: the turn goes on', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', notify('permission_prompt'))
    expect(state.get('s1')).toBe('waiting')
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('working')
  })

  it('a prompt submitted under a waiting screen leaves it waiting', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', notify('permission_prompt'))
    state.onHookEvent('s1', { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
    expect(state.get('s1')).toBe('waiting')
  })

  it('a waiting session returns to working when another call is still outstanding', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', pre('call-2'))
    state.onHookEvent('s1', notify('agent_needs_input'))
    expect(state.get('s1')).toBe('waiting')
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('working')
    state.onHookEvent('s1', post('call-2'))
    expect(state.get('s1')).toBe('working')
  })
})

describe('createAttentionState — Stop', () => {
  it('Stop clears every outstanding call, not just the value', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', pre('call-2'))
    state.onHookEvent('s1', stop())
    expect(state.get('s1')).toBe('idle')
    // If Stop had only flipped the value without clearing the outstanding set, this stray
    // PostToolUse would still find call-2 in it and report working again.
    state.onHookEvent('s1', post('call-1'))
    expect(state.get('s1')).toBe('idle')
  })
})

describe('createAttentionState — subscribe', () => {
  it('fires once for two identical transitions, and the returned unsubscribe stops it', () => {
    const state = createAttentionState()
    const seen: Array<[string, Attention]> = []
    const unsubscribe = state.subscribe((sessionId, value) => seen.push([sessionId, value]))
    state.onHookEvent('s1', pre('call-1'))
    state.onHookEvent('s1', pre('call-2')) // still working — one notification, not two
    expect(seen).toEqual([['s1', 'working']])
    unsubscribe()
    state.onHookEvent('s1', post('call-1'))
    state.onHookEvent('s1', post('call-2'))
    expect(seen).toEqual([['s1', 'working']]) // nothing added once unsubscribed
  })
})

describe('createAttentionState — forget', () => {
  it('drops the session, which then reads idle', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('call-1'))
    expect(state.get('s1')).toBe('working')
    state.forget('s1')
    expect(state.get('s1')).toBe('idle')
  })
})

describe('createAttentionState — set', () => {
  it('set writes a value outright and notifies only on change', () => {
    const s = createAttentionState()
    const seen: Array<[string, string]> = []
    s.subscribe((id, v) => seen.push([id, v]))
    s.set('c1', 'working')
    s.set('c1', 'working')
    s.set('c1', 'waiting')
    expect(s.get('c1')).toBe('waiting')
    expect(seen).toEqual([
      ['c1', 'working'],
      ['c1', 'waiting']
    ])
  })
})

/** What Claude Code 2.1.280 sends when an API error ends the turn, field for field (its builder
 *  `sAe`): the session fields every hook carries, `error` (rate_limit, overloaded,
 *  authentication_failed, server_error, …), `error_details` when there are any, and the error
 *  message's own text as `last_assistant_message`. It fires *instead of* Stop. */
const stopFailure = (error = 'rate_limit'): unknown => ({
  session_id: 'cc-1',
  transcript_path: 'D:/t.jsonl',
  cwd: 'D:/work',
  hook_event_name: 'StopFailure',
  error,
  last_assistant_message: 'API Error: Repeated 529 Overloaded errors'
})

// StopFailure is the other way a turn ends, so it ends a turn here exactly as Stop does. Before, a
// turn that errored left whatever the value was standing: `waiting` stayed up with nobody waiting,
// and the next real prompt was no transition, so the desktop notifier never fired for it.
describe('createAttentionState — StopFailure', () => {
  it('StopFailure ends the turn the way Stop does: idle, every outstanding call cleared', () => {
    const state = createAttentionState()
    const seen: Array<[string, Attention]> = []
    state.subscribe((id, value) => seen.push([id, value]))
    state.onHookEvent('w', pre('call-1'))
    state.onHookEvent('w', pre('call-2'))
    state.onHookEvent('q', pre('call-3'))
    state.onHookEvent('q', notify('permission_prompt'))
    seen.length = 0
    state.onHookEvent('w', stopFailure('overloaded'))
    state.onHookEvent('q', stopFailure('authentication_failed'))
    expect(state.get('w')).toBe('idle')
    expect(state.get('q')).toBe('idle')
    expect(seen).toEqual([
      ['w', 'idle'],
      ['q', 'idle']
    ])
    // cleared, not only flipped: a stray PostToolUse of one of them does not bring working back
    state.onHookEvent('w', post('call-1'))
    expect(state.get('w')).toBe('idle')
  })

  it('a StopFailure for a session never seen creates nothing, as Stop does not', () => {
    const state = createAttentionState()
    const seen: Array<[string, Attention]> = []
    state.subscribe((id, value) => seen.push([id, value]))
    state.onHookEvent('fresh', stopFailure())
    expect(state.get('fresh')).toBe('idle')
    expect(seen).toEqual([])
  })

  // StopFailure and UserPromptSubmit are captured async, so a prompt submitted right after a failed
  // turn can have its UserPromptSubmit land first, and the old StopFailure after the new turn's first
  // tool call. The capture stamps when it started (`astera_at`); a turn end that happened before the
  // latest prompt belongs to the turn before it.
  it.each(['StopFailure', 'Stop'])('a %s older than the latest prompt does not end the new turn', (name) => {
    const state = createAttentionState()
    state.onHookEvent('w', { hook_event_name: 'UserPromptSubmit', prompt: 'again', astera_at: 1_020 })
    state.onHookEvent('w', { hook_event_name: 'PreToolUse', tool_use_id: 'call-1', astera_at: 1_500 })
    state.onHookEvent('w', { ...(stopFailure() as object), hook_event_name: name, astera_at: 1_000 })
    expect(state.get('w')).toBe('working')
    // the call returning does not end the new turn either; its own Stop does
    state.onHookEvent('w', { hook_event_name: 'PostToolUse', tool_use_id: 'call-1', astera_at: 1_600 })
    expect(state.get('w')).toBe('working')
    state.onHookEvent('w', { hook_event_name: 'Stop', astera_at: 2_000 })
    expect(state.get('w')).toBe('idle')
  })

  // An instant API error whose StopFailure lands before its own prompt: the prompt is older, so the
  // turn end stands.
  it('a StopFailure that landed before its own older prompt still ends the turn', () => {
    const state = createAttentionState()
    state.onHookEvent('w', { hook_event_name: 'PreToolUse', tool_use_id: 'call-1', astera_at: 900 })
    state.onHookEvent('w', { ...(stopFailure() as object), astera_at: 1_005 })
    state.onHookEvent('w', { hook_event_name: 'UserPromptSubmit', prompt: 'go', astera_at: 1_000 })
    expect(state.get('w')).toBe('idle')
    state.onHookEvent('w', { hook_event_name: 'PreToolUse', tool_use_id: 'call-2', astera_at: 2_000 })
    state.onHookEvent('w', { ...(stopFailure() as object), astera_at: 2_500 })
    expect(state.get('w')).toBe('idle')
  })

  // A wall clock set back 30 s during a turn stamps its Stop well before the prompt. That is far past
  // any reordering, so the stamps are not trusted and the Stop ends the turn as it lands.
  it('a Stop stamped 20 s before its prompt, after a clock step back, still ends the turn', () => {
    const state = createAttentionState()
    state.onHookEvent('w', { hook_event_name: 'UserPromptSubmit', prompt: 'go', astera_at: 1_000_000 })
    state.onHookEvent('w', { hook_event_name: 'PreToolUse', tool_use_id: 'call-1', astera_at: 1_000_000 - 25_000 })
    state.onHookEvent('w', { hook_event_name: 'Stop', astera_at: 1_000_000 - 20_000 })
    expect(state.get('w')).toBe('idle')
  })

  // Lines from a capture that predates the stamp keep the append-order rule, and so does a tie.
  it.each([
    ['no stamp', {}, {}],
    ['the same millisecond', { astera_at: 1_000 }, { astera_at: 1_000 }]
  ])('with %s the turn end ends the turn, as it always did', (_label, promptAt, endAt) => {
    const state = createAttentionState()
    state.onHookEvent('w', { hook_event_name: 'UserPromptSubmit', prompt: 'go', ...promptAt })
    state.onHookEvent('w', pre('call-1'))
    state.onHookEvent('w', { ...(stopFailure() as object), ...endAt })
    expect(state.get('w')).toBe('idle')
  })
})

describe('createAttentionState — UserPromptSubmit', () => {
  it('turns only an idle session to working, and notifies once for it', () => {
    const state = createAttentionState()
    const seen: Array<[string, Attention]> = []
    state.subscribe((id, value) => seen.push([id, value]))
    state.onHookEvent('w', pre('call-1'))
    state.onHookEvent('q', pre('call-2'))
    state.onHookEvent('q', notify('permission_prompt'))
    seen.length = 0
    for (const id of ['w', 'q', 'fresh']) state.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
    expect(state.get('w')).toBe('working')
    expect(state.get('q')).toBe('waiting')
    expect(state.get('fresh')).toBe('working')
    expect(seen).toEqual([['fresh', 'working']])
  })
})

describe('createAttentionState — malformed input', () => {
  it('a non-object payload and an unrecognised hook_event_name are ignored rather than throwing', () => {
    const state = createAttentionState()
    expect(() => state.onHookEvent('s1', null)).not.toThrow()
    expect(() => state.onHookEvent('s1', 'PreToolUse')).not.toThrow()
    expect(() => state.onHookEvent('s1', { hook_event_name: 'SessionStart' })).not.toThrow()
    expect(state.get('s1')).toBe('idle')
  })
})

describe('createAttentionState — working only while it really works', () => {
  const MIN = 60_000
  const at = (e: Record<string, unknown>, t: number): unknown => ({ ...e, astera_at: t })
  const clock = (t0: number): { now: () => number; set: (t: number) => void } => {
    let t = t0
    return { now: () => t, set: (n) => (t = n) }
  }

  it('person input after the tool started (Esc) ends working', () => {
    const c = clock(1000)
    const state = createAttentionState(c.now)
    state.onHookEvent('s1', at({ hook_event_name: 'PreToolUse', tool_use_id: 'a' }, 1000))
    expect(state.get('s1')).toBe('working')
    state.noteInput('s1', 2000)
    expect(state.get('s1')).toBe('idle')
  })

  it('11 minutes without output reads idle after a recheck; output keeps it working', () => {
    const c = clock(0)
    const state = createAttentionState(c.now)
    state.onHookEvent('s1', at({ hook_event_name: 'PreToolUse', tool_use_id: 'a' }, 0))
    state.onHookEvent('s2', at({ hook_event_name: 'PreToolUse', tool_use_id: 'b' }, 0))
    state.noteOutput('s2', 10 * MIN)
    c.set(11 * MIN)
    state.recheck()
    expect(state.get('s1')).toBe('idle')
    expect(state.get('s2')).toBe('working')
  })

  it('PostToolUseFailure clears the outstanding tool', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('a'))
    state.onHookEvent('s1', { hook_event_name: 'PostToolUseFailure', tool_use_id: 'a' })
    state.onHookEvent('s1', notify('idle_prompt'))
    // nothing outstanding any more, so the idle notice is no prompt on screen
    expect(state.get('s1')).toBe('working')
  })

  it('a thinking turn with no output for 11 minutes reads idle; one whose spinner draws stays working', () => {
    const c = clock(0)
    const state = createAttentionState(c.now)
    state.onHookEvent('s1', at({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, 0))
    state.onHookEvent('s2', at({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, 0))
    state.noteOutput('s2', 11 * MIN - 100)
    c.set(11 * MIN)
    state.recheck()
    expect(state.get('s1')).toBe('idle')
    expect(state.get('s2')).toBe('working')
  })

  it('typing the next message mid-turn keeps it working while the spinner draws; Esc then silence ends it', () => {
    const c = clock(1000)
    const state = createAttentionState(c.now)
    state.onHookEvent('s1', at({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, 1000))
    state.noteOutput('s1', 1900)
    c.set(2000)
    state.noteInput('s1', 2000)
    expect(state.get('s1')).toBe('working')
    state.noteOutput('s1', 2050) // the echo, or Claude Code drawing "Interrupted"
    c.set(2050 + INPUT_QUIET_MS - 1)
    state.recheck()
    expect(state.get('s1')).toBe('working')
    c.set(2050 + INPUT_QUIET_MS)
    state.recheck()
    expect(state.get('s1')).toBe('idle')
  })

  it('an exited session is never working', () => {
    const state = createAttentionState()
    state.onHookEvent('s1', pre('a'))
    state.recheck((id) => id === 's1')
    expect(state.get('s1')).toBe('idle')
    expect(isWorking({ open: true, exited: true, eventAt: 1, personInputAt: null, lastOutputAt: 1, startedAt: 1, now: 2 })).toBe(false)
  })

  it('app and Host agree on a shared event table', () => {
    const pre0 = at({ hook_event_name: 'PreToolUse', tool_use_id: 'a' }, 1000)
    const prompt0 = at({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, 1000)
    const table: { name: string; event: unknown; eventAt: number; input: number | null; output?: number; now: number; want: 'working' | 'idle' }[] = [
      { name: 'fresh tool', event: pre0, eventAt: 1000, input: null, now: 2000, want: 'working' },
      { name: 'input after', event: pre0, eventAt: 1000, input: 1500, now: 2000, want: 'idle' },
      { name: 'input before', event: pre0, eventAt: 1000, input: 500, now: 2000, want: 'working' },
      { name: 'decayed', event: pre0, eventAt: 1000, input: null, now: 1000 + 11 * MIN, want: 'idle' },
      { name: 'thinking', event: prompt0, eventAt: 1000, input: null, now: 1000 + 9 * MIN, want: 'working' },
      { name: 'thinking decayed', event: prompt0, eventAt: 1000, input: null, now: 1000 + 11 * MIN, want: 'idle' },
      { name: 'typed under a drawing spinner', event: prompt0, eventAt: 1000, input: 1500, output: 1990, now: 2000, want: 'working' },
      { name: 'typed, then silence', event: prompt0, eventAt: 1000, input: 1500, output: 1600, now: 1600 + INPUT_QUIET_MS, want: 'idle' }
    ]
    for (const row of table) {
      const state = createAttentionState(() => row.now)
      state.onHookEvent('s', row.event)
      if (row.output !== undefined) state.noteOutput('s', row.output)
      if (row.input !== null) state.noteInput('s', row.input)
      state.recheck()
      const host = sessionStateOf({ lastLine: JSON.stringify(row.event), eventAt: row.eventAt, lastInputAt: row.input, lastOutputAt: row.output ?? null, now: row.now })
      // The Host answers unknown for input after the event where the app says idle: neither is working
      const norm = host === 'unknown' ? 'idle' : host
      expect(state.get('s'), row.name).toBe(row.want)
      expect(norm, row.name).toBe(row.want === 'working' ? 'working' : 'idle')
    }
  })
})
