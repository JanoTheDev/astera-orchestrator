import { describe, it, expect } from 'vitest'
import type { SessionInfo } from '../types'
import { ConnectionNotifier } from './notifier'
import { ConnectionFanout } from './fanout'

const info: SessionInfo = { id: 's-1', accountId: 'a', cwd: '/p', status: 'running', title: 'p' }

function notifier(name: string, posts: string[]): ConnectionNotifier {
  const n = new ConnectionNotifier({
    name,
    noteKeys: [`${name}Thread`, `${name}Chat`],
    textMax: 1000,
    enabledFor: () => true,
    getAccount: () => null,
    readStatusPayload: async () => null,
    lang: () => 'en',
    log: () => {}
  })
  n.setTransport({ supportsThreads: false, post: async (text) => (posts.push(`${name}:${text}`), null) })
  return n
}

describe('ConnectionFanout', () => {
  it('hands every input to every connection, each reading its own noted thread', async () => {
    const posts: string[] = []
    const a = notifier('a', posts)
    const b = notifier('b', posts)
    const fan = new ConnectionFanout([a, b])
    fan.register(info, { aThread: '1', aChat: 'c' })
    expect(fan.has('s-1')).toBe(true)
    fan.onRollState({ sessionId: 's-1', state: 'nudged' })
    await new Promise((r) => setTimeout(r, 0))
    expect(posts.map((p) => p.split(':')[0])).toEqual(['a', 'b'])
    expect(await fan.postNotice('n')).toBe(true)
    expect(posts.slice(2)).toEqual(['a:n', 'b:n'])
  })

  it('keeps going past a connection that throws', () => {
    const posts: string[] = []
    const bad = notifier('bad', posts)
    bad.rename = () => {
      throw new Error('boom')
    }
    const good = notifier('good', posts)
    good.register(info)
    const logs: string[] = []
    new ConnectionFanout([bad, good], (m) => logs.push(m)).rename('s-1', 'renamed')
    expect(logs).toEqual(['connections: rename failed(Error)'])
    expect(good.has('s-1')).toBe(true)
  })
})
