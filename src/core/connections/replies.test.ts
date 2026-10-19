import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReplyRouter, type ReplyRouterDeps } from './replies'
import type { ChatRequest } from '../chat/types'
import type { AskForm } from '../prompts/askUserQuestion'
import { t } from '../i18n'

const form: AskForm = {
  questions: [
    { header: 'Format', question: 'Which?', multiSelect: false, options: [{ label: 'A', description: null }, { label: 'B', description: null }] }
  ]
}
const question: ChatRequest = { id: 'q1', kind: 'question', form }
const approval: ChatRequest = { id: 'a1', kind: 'approval', about: { tool: 'Write', lines: ['x'] }, decisions: ['accept', 'decline'] }

function setup(over: Partial<ReplyRouterDeps> = {}) {
  const writes: string[] = []
  const notes: string[] = []
  const deliver: string[] = []
  const answers: unknown[] = []
  const deps: ReplyRouterDeps = {
    resolveSession: (target) => (target === 'T' ? 's1' : null),
    write: (_id, data) => (writes.push(data), true),
    postNote: async (_to, text) => void notes.push(text),
    lang: () => 'en',
    deliverChat: async (_id, text) => void deliver.push(text),
    answerChat: async (_id, requestId, answer) => void answers.push({ requestId, answer }),
    log: () => {},
    ...over
  }
  return { router: new ReplyRouter(deps, 'test'), writes, notes, deliver, answers }
}
const reply = (text: string, target = 'T') => ({ target, text, noteTo: 'N' })

describe('ReplyRouter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pty route: writes the text, then Enter after the delay', async () => {
    const h = setup()
    await h.router.route(reply('hello'))
    expect(h.writes).toEqual(['hello'])
    await vi.advanceTimersByTimeAsync(150)
    expect(h.writes).toEqual(['hello', '\r'])
  })

  it('unknown session: posts the sessionEnded note', async () => {
    const h = setup()
    await h.router.route(reply('hi', 'gone'))
    expect(h.notes).toEqual([t('en', 'slack.inbox.sessionEnded')])
    expect(h.writes).toEqual([])
  })

  it('write returning false: notes and sends no Enter', async () => {
    const h = setup({ write: () => false })
    await h.router.route(reply('hi'))
    expect(h.notes).toEqual([t('en', 'slack.inbox.sessionEnded')])
    await vi.advanceTimersByTimeAsync(500)
    expect(h.writes).toEqual([])
  })

  describe('chat route', () => {
    it('no card: the text is one chat turn', async () => {
      const h = setup({ isChat: () => true, pendingRequest: () => null })
      await h.router.route(reply('do it'))
      expect(h.deliver).toEqual(['do it'])
      expect(h.writes).toEqual([])
    })

    it('question card: the reply answers it', async () => {
      const h = setup({ isChat: () => true, pendingRequest: () => question })
      await h.router.route(reply('2'))
      expect(h.answers).toEqual([{ requestId: 'q1', answer: { kind: 'question', answers: [{ picks: [1], other: '' }] } }])
    })

    it('approval card: the word decides it', async () => {
      const h = setup({ isChat: () => true, pendingRequest: () => approval })
      await h.router.route(reply('no'))
      expect(h.answers).toEqual([{ requestId: 'a1', answer: { kind: 'approval', decision: 'decline' } }])
    })

    it('approval card: an unknown word is noted, nothing answered', async () => {
      const h = setup({ isChat: () => true, pendingRequest: () => approval })
      await h.router.route(reply('maybe'))
      expect(h.notes).toEqual([t('en', 'slack.approval.unknownReply')])
      expect(h.answers).toEqual([])
    })
  })

  describe('choice prompt', () => {
    const shape = () => [{ multiSelect: true, optionCount: 3 }]

    it('writes the keys one at a time, KEY_DELAY_MS apart', async () => {
      const h = setup({ pendingChoiceShape: shape })
      await h.router.route(reply('1,3'))
      expect(h.writes).toEqual(['1'])
      await vi.advanceTimersByTimeAsync(150)
      expect(h.writes).toEqual(['1', '3'])
      await vi.advanceTimersByTimeAsync(150 * 2)
      expect(h.writes).toEqual(['1', '3', '\t', '\r'])
    })

    it('malformed reply: noted, nothing written', async () => {
      const h = setup({ pendingChoiceShape: shape })
      await h.router.route(reply('9'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.writes).toEqual([])
      expect(h.notes).toHaveLength(1)
      expect(h.notes[0]).toMatch(/^⚠️ /)
    })
  })
})
