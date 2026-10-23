import { describe, expect, it, vi } from 'vitest'
import { askInNewSession, type AskSessionDeps } from './askSession'

/** A fake event source, a start that answers when told, and a timer fired by hand. */
function rig(startId: string | null) {
  const listeners = new Set<(id: string) => void>()
  let answer!: (id: string | null) => void
  const timers: Array<() => void> = []
  const deps: AskSessionDeps = {
    onReady: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    start: () => new Promise((r) => (answer = r)),
    send: vi.fn(async () => undefined),
    settled: vi.fn(),
    setTimer: (fn) => void timers.push(fn),
    timeoutMs: 1000
  }
  return {
    deps,
    ready: (id: string) => [...listeners].forEach((l) => l(id)),
    answer: () => answer(startId),
    fire: () => timers.forEach((t) => t()),
    listening: () => listeners.size
  }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('askInNewSession', () => {
  it('sends once the started session says it is ready', async () => {
    const r = rig('s1')
    const p = askInNewSession('fix it', r.deps)
    r.answer()
    expect(await p).toBe('s1')
    expect(r.deps.send).not.toHaveBeenCalled()
    r.ready('other')
    r.ready('s1')
    await flush()
    expect(r.deps.send).toHaveBeenCalledWith('s1', 'fix it')
    expect(r.deps.settled).toHaveBeenCalledWith('sent')
    expect(r.listening()).toBe(0)
  })

  it('sends at once when ready came before start answered the id', async () => {
    const r = rig('s1')
    const p = askInNewSession('fix it', r.deps)
    r.ready('s1')
    r.answer()
    await p
    await flush()
    expect(r.deps.send).toHaveBeenCalledTimes(1)
    expect(r.deps.settled).toHaveBeenCalledWith('sent')
  })

  it('times out when the session never says it is ready, and a late ready sends nothing', async () => {
    const r = rig('s1')
    const p = askInNewSession('fix it', r.deps)
    r.answer()
    await p
    r.fire()
    r.ready('s1')
    await flush()
    expect(r.deps.settled).toHaveBeenCalledWith('timeout')
    expect(r.deps.send).not.toHaveBeenCalled()
  })

  it('reports a failed send', async () => {
    const r = rig('s1')
    r.deps.send = vi.fn(async () => Promise.reject(new Error('gone')))
    const p = askInNewSession('fix it', r.deps)
    r.answer()
    await p
    r.ready('s1')
    await flush()
    expect((r.deps.settled as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(new Error('gone'))
  })

  it('answers null and stops listening when nothing started', async () => {
    const r = rig(null)
    const p = askInNewSession('fix it', r.deps)
    r.answer()
    expect(await p).toBeNull()
    expect(r.listening()).toBe(0)
    expect(r.deps.settled).not.toHaveBeenCalled()
  })
})
