import { describe, it, expect } from 'vitest'
import { exitStatusOf } from './exitStatus'

describe('exitStatusOf', () => {
  it.each([
    [0, 'exit.finished', 'ok'],
    [129, 'exit.closed', 'muted'],
    [143, 'exit.closed', 'muted'],
    [130, 'exit.interrupted', 'muted'],
    [137, 'exit.killed', 'danger']
  ] as const)('code %i reads %s with tone %s and no number', (code, key, tone) => {
    expect(exitStatusOf(code)).toEqual({ key, tone })
  })
  it('any other code is a failure and carries the number', () => {
    expect(exitStatusOf(2)).toEqual({ key: 'exit.failed', params: { code: 2 }, tone: 'danger' })
  })
})
