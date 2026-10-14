// Waiting on the real clock in a test (load-sensitive tests, 2026-10-14). For tests only.
//
// A rig that fakes the timers and then waits for something on the real clock (the store's disk writes, a child
// process) used vi.waitFor, which moves fake time by its interval at every check: the longer the wait under load, the
// further the rig's clock moved past timers the test had not advanced to (the exit deferral, the rolling tick). This
// polls on the timers this module captured when it loaded, before any test faked them, and moves no fake time.

const realSetTimeout = globalThis.setTimeout
const realNow = performance.now.bind(performance)

/** Calls `check` until it stops throwing (or rejecting), every `interval` ms of real time, and answers what it returned;
 *  after `timeout` ms (10 s by default) fails with its last error. */
export async function untilReal<T>(check: () => T | Promise<T>, o: { timeout?: number; interval?: number } = {}): Promise<T> {
  const end = realNow() + (o.timeout ?? 10_000)
  const interval = o.interval ?? 20
  for (;;) {
    try {
      return await check()
    } catch (err) {
      if (realNow() >= end) throw err
    }
    await new Promise((resolve) => realSetTimeout(resolve, interval))
  }
}
