import { describe, expect, it, vi } from 'vitest'
import { makeActions, findActionForEvent, resolveBindings } from '../../../core/keys/binding'
import {
  RECENT_MAX, closeSessionTab, forget, recentlyClosed, recordClosed, remember, reopenClosed, reopenWayOf, setReopenHandler,
  type CloseDeps, type ClosedTab
} from './recentlyClosed'

const entry = (sessionId: string, over: Partial<ClosedTab> = {}): ClosedTab => ({
  sessionId, title: sessionId, cwd: '/repo', accountId: 'acc1', closedAt: 0, ended: false, ...over
})

const deps = (over: Partial<CloseDeps> = {}): CloseDeps & { hide: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; ask: ReturnType<typeof vi.fn> } => ({
  isAgent: () => false,
  status: () => 'running',
  pref: () => null,
  setPref: vi.fn(),
  ask: vi.fn(async () => ({ how: 'hide' as const, remember: false })),
  hide: vi.fn(),
  end: vi.fn(),
  ...over
}) as never

describe('Recently closed list', () => {
  it('keeps the newest 20, newest first, one entry per session', () => {
    let list: ClosedTab[] = []
    for (let i = 0; i < 25; i++) list = remember(list, entry(`s${i}`))
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0].sessionId).toBe('s24')
    expect(list.at(-1)?.sessionId).toBe('s5')
    list = remember(list, entry('s10', { ended: true }))
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]).toMatchObject({ sessionId: 's10', ended: true })
    expect(list.filter((x) => x.sessionId === 's10')).toHaveLength(1)
    expect(forget(list, 's10').some((x) => x.sessionId === 's10')).toBe(false)
  })

  it('reopens a running session by re-attach and an ended one by resume', () => {
    expect(reopenWayOf('running')).toBe('attach')
    expect(reopenWayOf('exited')).toBe('resume')
    expect(reopenWayOf(undefined)).toBe('resume')
  })

  it('Ctrl+Shift+T reopens the newest; a named one reopens that one', () => {
    const got: string[] = []
    setReopenHandler((e) => got.push(e.sessionId))
    recordClosed(entry('old'))
    recordClosed(entry('new'))
    expect(recentlyClosed()[0].sessionId).toBe('new')
    reopenClosed()
    reopenClosed('old')
    expect(got).toEqual(['new', 'old'])
    const actions = makeActions('linux')
    const ev = { code: 'KeyT', key: 'T', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent
    expect(findActionForEvent(resolveBindings({}, actions), ev, actions)).toBe('tabs.reopenClosed')
  })
})

describe('closeSessionTab', () => {
  it("hides a worker's tab and never ends it", async () => {
    const d = deps({ isAgent: (id) => id === 'w1' })
    expect(await closeSessionTab('w1', undefined, d)).toBe('hide')
    expect(d.hide).toHaveBeenCalledWith('w1')
    expect(d.end).not.toHaveBeenCalled()
    expect(d.ask).not.toHaveBeenCalled()
  })

  it("asks on the owner's own running console, and remembers when told", async () => {
    const setPref = vi.fn()
    const d = deps({ setPref, ask: vi.fn(async () => ({ how: 'hide' as const, remember: true })) })
    expect(await closeSessionTab('mine', undefined, d)).toBe('hide')
    expect(d.ask).toHaveBeenCalledOnce()
    expect(setPref).toHaveBeenCalledWith('hide')
    expect(d.end).not.toHaveBeenCalled()
    const e = deps({ ask: vi.fn(async () => ({ how: 'end' as const, remember: false })) })
    expect(await closeSessionTab('mine', undefined, e)).toBe('end')
    expect(e.end).toHaveBeenCalledWith('mine')
  })

  it('follows a stored answer, closes an ended console without asking, and obeys an explicit how', async () => {
    const stored = deps({ pref: () => 'end' })
    expect(await closeSessionTab('mine', undefined, stored)).toBe('end')
    expect(stored.ask).not.toHaveBeenCalled()
    const ended = deps({ status: () => 'exited' })
    expect(await closeSessionTab('mine', undefined, ended)).toBe('end')
    expect(ended.ask).not.toHaveBeenCalled()
    const auto = deps({ status: () => 'exited' })
    expect(await closeSessionTab('w9', 'hide', auto)).toBe('hide')
    expect(auto.end).not.toHaveBeenCalled()
  })
})
