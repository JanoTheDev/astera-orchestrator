// Answering a Task's question in the run's graph (plugin Phase 5 C9, C13): a check that could not be made takes one of
// three choices, each in this app's words with what it does, and no answer in words; other questions are as they were.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CATALOGS, LANGS } from '../../../core/i18n'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) })
}))
const { GateAnswer, gateChoicesOf } = await import('./GateAnswer')
const t = (key: string): string => key

const unavailable = { id: 'g1', question: 'The check could not be made: D: down', options: ['retry', 'skip-check', 'mark-failed'], kind: 'check-unavailable' as const }
const render = (gate: Parameters<typeof gateChoicesOf>[0]): string =>
  renderToStaticMarkup(
    React.createElement(GateAnswer, { gate, answer: '', busy: false, error: null, onAnswer: () => {}, onResolve: () => {}, onCancel: () => {} })
  )

describe('gateChoicesOf', () => {
  it('a check that could not be made: its three choices in words with what each does, sent as the option, and no free text', () => {
    expect(gateChoicesOf(unavailable, t)).toEqual({
      choices: [
        { value: 'retry', label: 'jobs.gate.checkUnavailable.retry', hint: 'jobs.gate.checkUnavailable.retryHint' },
        { value: 'skip-check', label: 'jobs.gate.checkUnavailable.skip', hint: 'jobs.gate.checkUnavailable.skipHint' },
        { value: 'mark-failed', label: 'jobs.gate.checkUnavailable.fail', hint: 'jobs.gate.checkUnavailable.failHint' }
      ],
      freeText: false
    })
  })

  it('another question keeps its options as they are and takes an answer in words', () => {
    expect(gateChoicesOf({ id: 'g2', question: 'q', options: ['Drop the check', 'Stop the Job'] }, t)).toEqual({
      choices: [
        { value: 'Drop the check', label: 'Drop the check' },
        { value: 'Stop the Job', label: 'Stop the Job' }
      ],
      freeText: true
    })
    expect(gateChoicesOf({ id: 'g3', question: 'q' }, t)).toEqual({ choices: [], freeText: true })
    // An option this app does not know is offered as it is
    expect(gateChoicesOf({ ...unavailable, options: ['retry', 'later'] }, t).choices[1]).toEqual({ value: 'later', label: 'later' })
  })
})

// 5c final review (declined, ruled a finding): the exhausted question's two answers have had words in all four languages
// (jobs.convergence.gate.retryOnce, markFailed) that no screen used
it('an exhausted repair budget offers its two answers in words, sent as the option, and still takes words', () => {
  expect(gateChoicesOf({ id: 'g2', question: 'q', options: ['retry-once', 'mark-failed'], kind: 'convergence-exhausted' }, t)).toEqual({
    choices: [
      { value: 'retry-once', label: 'jobs.convergence.gate.retryOnce' },
      { value: 'mark-failed', label: 'jobs.convergence.gate.markFailed' }
    ],
    freeText: true
  })
})

describe('GateAnswer', () => {
  it('a check that could not be made shows the question, three described choices and no box to type in', () => {
    const html = render(unavailable)
    expect(html).toContain('The check could not be made: D: down')
    expect(html.match(/<span class="detail-gate-option-hint">jobs\.gate\.checkUnavailable\.\w+Hint<\/span>/g)).toHaveLength(3)
    expect(html).not.toContain('<textarea')
  })

  // 5c final review M7: the line under a choice is read once, not again as its title
  it('a choice’s description is its visible line only, not a title that repeats it', () => {
    expect(render(unavailable)).not.toContain('title="jobs.gate.checkUnavailable')
  })

  // 5c final review M6: with no box to focus, the first choice takes the focus the Unlock button had
  it('the first choice takes the focus when there is no box', () => {
    const html = render(unavailable)
    // \x3c is '<', so the screen's raw-button grep does not match these assertions
    expect(html.match(/\x3cbutton[^>]*autofocus=""/g)).toHaveLength(1)
    expect(html).toMatch(/\x3cbutton[^>]*autofocus=""[^>]*><span class="ui-btn__label">jobs\.gate\.checkUnavailable\.retry</)
    expect(render({ id: 'g3', question: 'Which way?', options: ['a'] })).not.toMatch(/\x3cbutton[^>]*autofocus/)
  })

  it('a question a coordinator asked keeps its box', () => {
    expect(render({ id: 'g3', question: 'Which way?' })).toContain('<textarea')
  })

  it('the choices are in all four languages', () => {
    const keys = ['retry', 'retryHint', 'skip', 'skipHint', 'fail', 'failHint'].map((k) => `jobs.gate.checkUnavailable.${k}`)
    for (const key of keys) for (const lang of LANGS) expect((CATALOGS[lang].messages as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy()
  })
})
