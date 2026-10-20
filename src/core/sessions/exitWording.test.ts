import { describe, it, expect } from 'vitest'
import { exitWording } from './exitWording'
import { CATALOGS, LANGS } from '../i18n'

describe('exitWording', () => {
  it('reads 0 as Finished, muted', () => {
    expect(exitWording(0)).toEqual({ key: 'exit.finished', tone: 'muted' })
  })
  it('reads 129 (the Host hanging up after the agent finished) as a muted normal close', () => {
    expect(exitWording(129)).toEqual({ key: 'exit.closedByAstera', tone: 'muted' })
  })
  it('reads 130 as Stopped (Ctrl+C), muted', () => {
    expect(exitWording(130)).toEqual({ key: 'exit.stopped', tone: 'muted' })
  })
  it('reads 137 as Killed, danger', () => {
    expect(exitWording(137)).toEqual({ key: 'exit.killed', tone: 'danger' })
  })
  it('reads 143 as a muted close only when Astera closed the tab', () => {
    expect(exitWording(143, { closedByAstera: true })).toEqual({ key: 'exit.closedByAstera', tone: 'muted' })
    expect(exitWording(143)).toEqual({ key: 'exit.failed', params: { code: '143' }, tone: 'danger' })
  })
  it('reads an unknown code as Failed (code N), danger', () => {
    expect(exitWording(2)).toEqual({ key: 'exit.failed', params: { code: '2' }, tone: 'danger' })
  })
  it('reads a missing code as Failed (code ?)', () => {
    expect(exitWording(null)).toEqual({ key: 'exit.failed', params: { code: '?' }, tone: 'danger' })
  })
  it('has every exit key in every locale', () => {
    for (const lang of LANGS) {
      for (const key of ['exit.finished', 'exit.closedByAstera', 'exit.stopped', 'exit.killed', 'exit.failed'] as const) {
        expect(CATALOGS[lang].messages[key]).toBeTruthy()
      }
    }
  })
})
