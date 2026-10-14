// Waiting on the real clock in a test that fakes the timers (load-sensitive tests, 2026-10-14, final review I2 and m4):
// vi.waitFor moves fake time by its interval at every check, so a long wait over real disk writes moved the rig's clock
// past timers the test had not advanced to.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { untilReal } from './testWait'

afterEach(() => {
  vi.useRealTimers()
})

describe('untilReal', () => {
  it('answers what the check returns once it stops throwing', async () => {
    let tries = 0
    await expect(
      untilReal(() => {
        tries += 1
        if (tries < 3) throw new Error('not yet')
        return 'done'
      })
    ).resolves.toBe('done')
    expect(tries).toBe(3)
  })

  it('fails with the check’s last error once its time is up', async () => {
    await expect(
      untilReal(
        () => {
          throw new Error('never')
        },
        { timeout: 60 }
      )
    ).rejects.toThrow('never')
  })

  it('leaves fake timers where they are while it waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] })
    const fired = vi.fn()
    setTimeout(fired, 1)
    let tries = 0
    await untilReal(() => {
      tries += 1
      if (tries < 5) throw new Error('not yet')
    })
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalled()
  })
})
