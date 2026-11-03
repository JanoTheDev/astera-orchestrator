import { describe, expect, it } from 'vitest'
import { hostPidAlive, parseEndedByApp } from './endedByApp'

describe('the app’s note that it ended a Host', () => {
  it('reads a whole note, and nothing from a partial or broken one', () => {
    expect(parseEndedByApp('{"pid":39884,"at":5,"why":"it was not answering"}')).toEqual({ pid: 39884, at: 5, why: 'it was not answering' })
    expect(parseEndedByApp('{"pid":"39884","at":5,"why":"x"}')).toBeNull()
    expect(parseEndedByApp('{"pid":1,"at":5}')).toBeNull()
    expect(parseEndedByApp('{"pid":1,')).toBeNull()
  })

  it('a pid runs unless signal 0 says it is gone; EPERM is one that runs', () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(hostPidAlive(1, () => true)).toBe(true)
    expect(hostPidAlive(1, fail('ESRCH'))).toBe(false)
    expect(hostPidAlive(1, fail('EPERM'))).toBe(true)
    expect(hostPidAlive(process.pid)).toBe(true)
  })
})
