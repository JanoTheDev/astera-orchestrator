import { describe, expect, it } from 'vitest'
import { INTENT_KINDS, readIntent } from './types'
import { mayStart, SAFETY } from './safety'

describe('readIntent — the coordinator model answer is a trust boundary', () => {
  it('keeps an intent of the schema and drops keys it does not have', () => {
    expect(readIntent({ kind: 'send', session: ' worker 2 ', text: 'go', target: 'Trading', extra: 1 })).toEqual({
      kind: 'send',
      session: 'worker 2',
      text: 'go',
      target: 'Trading'
    })
    expect(readIntent({ kind: 'summarize', minutes: 15 })).toEqual({ kind: 'summarize', minutes: 15 })
  })

  it.each([
    null,
    'pause',
    { kind: 'rm -rf' },
    { kind: 'send', session: 'w' },
    { kind: 'plan', objective: '   ' },
    { kind: 'summarize', minutes: -5 },
    { kind: 'summarize', minutes: 1.5 },
    { kind: 'reply', text: 'x'.repeat(5000) }
  ])('refuses %j', (v) => {
    expect(readIntent(v)).toBeNull()
  })
})

describe('safety', () => {
  it('classes every intent', () => {
    for (const k of INTENT_KINDS) expect(SAFETY[k]).toBeDefined()
  })

  it('never starts a destructive or quota-spending intent from a parse alone (a voice transcript lands as auto)', () => {
    for (const k of ['approve', 'pause', 'stop-launching', 'archive', 'delete', 'merge'] as const) {
      expect(SAFETY[k]).toBe('confirm')
      expect(mayStart(k, 'auto')).toBe(false)
    }
    for (const k of ['plan', 'send', 'resume'] as const) expect(mayStart(k, 'auto')).toBe(false)
  })

  it('answers status questions at once', () => {
    for (const k of ['summarize', 'waiting', 'switch', 'show-sessions', 'reply'] as const) expect(mayStart(k, 'auto')).toBe(true)
  })
})
