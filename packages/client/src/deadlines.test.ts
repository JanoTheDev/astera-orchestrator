// How long a client waits for an answer: past the Host's own deadline for a command that waits on the Host, the
// ordinary deadline for the rest (the CLI's rule, src/cli/follow.ts clientTimeoutMs, now the SDK's too).
import { describe, it, expect } from 'vitest'
import { callDeadlineMs, DEFAULT_ASK_TIMEOUT_MS, DEFAULT_CHECK_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS, TIMEOUT_HEADROOM_MS } from './deadlines.js'

const ORDINARY = 1234

describe('callDeadlineMs', () => {
  it('outwaits the deadline a call names in timeoutMs', () => {
    expect(callDeadlineMs({ cmd: 'runs-wait', args: { timeoutMs: 5000 } }, ORDINARY)).toBe(5000 + TIMEOUT_HEADROOM_MS)
    expect(callDeadlineMs({ cmd: 'x-cmd', args: { timeoutMs: 7 } }, ORDINARY)).toBe(7 + TIMEOUT_HEADROOM_MS)
  })

  it("outwaits the Host's default deadline of a command that waits", () => {
    expect(callDeadlineMs({ cmd: 'ask', args: {} }, ORDINARY)).toBe(DEFAULT_ASK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
    for (const a of [{ cmd: 'runs-wait', args: {} }, { cmd: 'jobs-wait', args: {} }, { cmd: 'sessions-send', args: { wait: true } }])
      expect(callDeadlineMs(a, ORDINARY), a.cmd).toBe(DEFAULT_WAIT_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
    expect(callDeadlineMs({ cmd: 'check', args: { wait: true } }, ORDINARY)).toBe(DEFAULT_CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
  })

  it('gives every other command the ordinary deadline', () => {
    expect(callDeadlineMs({ cmd: 'jobs-list', args: {} }, ORDINARY)).toBe(ORDINARY)
    expect(callDeadlineMs({ cmd: 'sessions-send', args: { wait: false } }, ORDINARY)).toBe(ORDINARY)
    expect(callDeadlineMs({ cmd: 'x-cmd', args: { timeoutMs: '7' } }, ORDINARY)).toBe(ORDINARY)
  })

  it('keeps the deadlines the Host uses', () => {
    expect([DEFAULT_WAIT_TIMEOUT_MS, DEFAULT_ASK_TIMEOUT_MS, DEFAULT_CHECK_TIMEOUT_MS, TIMEOUT_HEADROOM_MS]).toEqual([3_600_000, 600_000, 300_000, 30_000])
  })
})
