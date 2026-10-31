import { describe, it, expect } from 'vitest'
import type { Account, SessionInfo } from '../types'
import { ConnectionNotifier, type ConnectionDeps } from './notifier'
import type { ConnectionTransport } from './transport'

const account: Account = { id: 'acc-1', label: 'work1', configDir: '/cfg', color: '#fff', createdAt: '2026-07-23T00:00:00Z' }
const info = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's-1', accountId: 'acc-1', cwd: '/proj', status: 'running', title: 'proj', ...over
})
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** A threaded transport whose every post gets the next numeric id, like a chat whose replies point at
 *  the exact message they answer. */
function setup(over: Partial<ConnectionDeps> = {}): { notifier: ConnectionNotifier; posts: { text: string; thread?: string; id: string }[]; notes: unknown[] } {
  const posts: { text: string; thread?: string; id: string }[] = []
  const notes: unknown[] = []
  let next = 0
  const transport: ConnectionTransport = {
    supportsThreads: true,
    post: async (text, thread) => {
      const id = String(++next)
      posts.push({ text, thread, id })
      return id
    }
  }
  const notifier = new ConnectionNotifier({
    name: 'test',
    noteKeys: ['testThread', 'testChat'],
    textMax: 100,
    enabledFor: (i) => i.title !== 'off',
    getAccount: () => account,
    readStatusPayload: async () => null,
    lang: () => 'en',
    log: () => {},
    remember: (sid, patch) => notes.push({ sid, patch }),
    ...over
  })
  notifier.setTransport(transport, 'chat-1')
  return { notifier, posts, notes }
}

describe('ConnectionNotifier — a reply to any message it posted', () => {
  it('resolves the id of any message posted for a live session, not only the root', async () => {
    const { notifier, posts } = setup()
    notifier.register(info())
    notifier.onRollState({ sessionId: 's-1', state: 'nudged' })
    await flush()
    expect(posts).toHaveLength(2)
    const [root, notice] = posts
    expect(notice.thread).toBe(root.id)
    expect(notifier.resolveSessionByThread(root.id)).toBe('s-1')
    expect(notifier.resolveSessionByThread(notice.id)).toBe('s-1')
    expect(notifier.resolveSessionByThread('999')).toBeNull()
  })

  it('follows a roll to the new id and forgets the session once it has exited', async () => {
    const { notifier, posts } = setup()
    notifier.register(info())
    notifier.onRollState({ sessionId: 's-1', state: 'nudged' })
    await flush()
    const notice = posts[1].id
    notifier.onRolled('s-1', info({ id: 's-2' }))
    await flush()
    expect(notifier.resolveSessionByThread(notice)).toBe('s-2')
    notifier.handleExit({ sessionId: 's-2', exitCode: 0 })
    await new Promise((r) => setTimeout(r, 3_100))
    expect(notifier.resolveSessionByThread(notice)).toBeNull()
  })

  it('forgets every posted id when the transport changes', async () => {
    const { notifier, posts } = setup()
    notifier.register(info())
    notifier.onRollState({ sessionId: 's-1', state: 'nudged' })
    await flush()
    notifier.setTransport(null)
    expect(notifier.resolveSessionByThread(posts[1].id)).toBeNull()
  })
})

describe('ConnectionNotifier — how a waiting limit is worded', () => {
  const waiting = async (scope: 'session' | 'weekly' | 'usage' | undefined): Promise<string> => {
    const { notifier, posts } = setup()
    notifier.register(info())
    notifier.onRollState({ sessionId: 's-1', state: 'waiting', nextRetryAt: new Date(Date.now() + 3_600_000).toISOString(), ...(scope ? { scope } : {}) })
    await flush()
    return posts.map((p) => p.text).join('\n')
  }

  it('names the 5-hour limit for a session wait and the weekly one for a weekly wait', async () => {
    expect(await waiting('session')).toContain('(5-hour limit)')
    expect(await waiting('weekly')).toContain('(weekly limit)')
  })

  it('names no window for a wait on an account without a 5-hour window', async () => {
    const text = await waiting('usage')
    expect(text).toContain('(usage limit)')
    expect(text).not.toMatch(/5-hour|weekly/)
  })
})

describe('ConnectionNotifier — a pending tool call', () => {
  const ask = { questions: [{ question: 'Q?', options: [{ label: 'a' }, { label: 'b' }] }] }
  it('a failed call (PostToolUseFailure) drops the capture like PostToolUse', () => {
    for (const end of ['PostToolUse', 'PostToolUseFailure']) {
      const { notifier } = setup()
      notifier.register(info())
      notifier.onHookEvent('s-1', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: ask, tool_use_id: 'c1' })
      expect(notifier.pendingChoiceShape('s-1')).toEqual([{ multiSelect: false, optionCount: 2 }])
      notifier.onHookEvent('s-1', { hook_event_name: end, tool_use_id: 'c1' })
      expect(notifier.pendingChoiceShape('s-1')).toBeNull()
    }
  })
})

describe('ConnectionNotifier — what the connection injects', () => {
  it('registers only sessions the connection is enabled for, and notes the thread under its own keys', async () => {
    const { notifier, notes } = setup()
    notifier.register(info({ id: 's-off', title: 'off' }))
    expect(notifier.has('s-off')).toBe(false)
    notifier.register(info())
    await flush()
    expect(notes).toEqual([{ sid: 's-1', patch: { testThread: '1', testChat: 'chat-1' } }])
    expect(notifier.notedThreadOf({ testThread: '1', testChat: 'chat-1' })).toEqual({ ts: '1', channel: 'chat-1' })
  })

  it('cuts every message to its text cap, prefix included', async () => {
    const { notifier, posts } = setup()
    expect(await notifier.postNotice('x'.repeat(150))).toBe(true)
    expect(posts[0].text).toHaveLength(100)
    expect(posts[0].text.endsWith('…')).toBe(true)
  })
})
