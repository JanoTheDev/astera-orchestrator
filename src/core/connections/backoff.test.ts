import { describe, expect, it } from 'vitest'
import { reconnectDelayMs, RECONNECT_CAP_MS } from './backoff'

describe('reconnectDelayMs', () => {
  it('grows with each failure and is capped at five minutes', () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(reconnectDelayMs(9)).toBe(RECONNECT_CAP_MS)
    expect(reconnectDelayMs(500)).toBe(RECONNECT_CAP_MS)
    expect(RECONNECT_CAP_MS).toBe(5 * 60_000)
  })

  it('treats a negative attempt as the first', () => {
    expect(reconnectDelayMs(-3)).toBe(1_000)
  })
})
