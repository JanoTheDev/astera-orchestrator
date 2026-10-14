// Plugin Phase 3 (events and notifications design N3): the app tells a Host that records session events what only
// the app sees of its sessions, whoever owns Slack, and nothing to a Host that does not announce it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSessionSignalForwarder } from './sessionSignals'
import { HOST_FEATURE_SESSION_SIGNALS, type ClientMessage } from '../core/host/protocol'

const session = { id: 'c1', kind: 'chat' as const, title: 't', provider: 'claude' as const, cwd: 'D:\\p' }

function host(features: string[] = [HOST_FEATURE_SESSION_SIGNALS], connected = true) {
  const sent: ClientMessage[] = []
  return { sent, h: { status: () => ({ connected, features }), send: (m: ClientMessage) => (sent.push(m), true) } }
}

describe('the session signal forwarder', () => {
  it('sends a chat status, a chat request by its kind, and a roll state', () => {
    const f = createSessionSignalForwarder({ log: () => {} })
    const { sent, h } = host()
    f.setHost(h)
    f.chat(session, { type: 'request', request: { id: 'r1', kind: 'approval', about: {} as never, decisions: [] } })
    f.chat(session, { type: 'status', status: 'waiting' })
    f.chat(session, { type: 'request', request: { id: 'r2', kind: 'question', form: {} as never } })
    f.chat(session, { type: 'request', request: null })
    f.rollState({ id: 's1', kind: 'terminal' }, { sessionId: 's1', state: 'waiting', scope: 'session' })
    expect(sent).toEqual([
      { t: 'session-signal', signal: { kind: 'chat', session, event: { type: 'request', request: 'approval' } } },
      { t: 'session-signal', signal: { kind: 'chat', session, event: { type: 'status', status: 'waiting' } } },
      { t: 'session-signal', signal: { kind: 'chat', session, event: { type: 'request', request: 'question' } } },
      { t: 'session-signal', signal: { kind: 'chat', session, event: { type: 'request', request: null } } },
      { t: 'session-signal', signal: { kind: 'roll-state', session: { id: 's1', kind: 'terminal' }, event: { sessionId: 's1', state: 'waiting', scope: 'session' } } }
    ])
  })

  it('sends no other chat event', () => {
    const f = createSessionSignalForwarder({ log: () => {} })
    const { sent, h } = host()
    f.setHost(h)
    f.chat(session, { type: 'error', message: 'x' })
    f.chat(session, { type: 'ready', threadId: 't', rolloutPath: null })
    expect(sent).toEqual([])
  })

  // Review Focus 3: a Host that does not announce the feature, or none at all, is sent nothing
  it('sends nothing to a Host without the feature, to a Host away, or with no Host', () => {
    const f = createSessionSignalForwarder({ log: () => {} })
    f.chat(session, { type: 'status', status: 'waiting' })
    const old = host([])
    f.setHost(old.h)
    f.chat(session, { type: 'status', status: 'waiting' })
    const away = host([HOST_FEATURE_SESSION_SIGNALS], false)
    f.setHost(away.h)
    f.chat(session, { type: 'status', status: 'waiting' })
    expect([...old.sent, ...away.sent]).toEqual([])
  })

  it('never throws: a send that throws is logged', () => {
    const logged: string[] = []
    const f = createSessionSignalForwarder({ log: (m) => logged.push(m) })
    f.setHost({
      status: () => ({ connected: true, features: [HOST_FEATURE_SESSION_SIGNALS] }),
      send: () => {
        throw new Error('socket')
      }
    })
    expect(() => f.rollState({ id: 's1', kind: 'terminal' }, { sessionId: 's1', state: 'waiting' })).not.toThrow()
    expect(logged.some((m) => m.includes('socket'))).toBe(true)
  })
})

// The wiring, read from the source as driving.integration.test.ts reads the Host's: the forwarder is the one index.ts
// makes and hands over with the rest of its share of the Host, the Host client hands it the Host, every chat event of
// the app's adapters reaches it, and the rolls of the app's own chains (never the Host's, which the Host records
// itself) reach it.
describe('the app wires the forwarder', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const index = readFileSync(path.join(here, 'index.ts'), 'utf8')
  const ipc = readFileSync(path.join(here, 'ipc.ts'), 'utf8')

  it('makes one forwarder and hands it over with the Host wiring', () => {
    expect(index.match(/createSessionSignalForwarder\(/g)).toHaveLength(1)
    const wiring = index.slice(index.indexOf('      fanOutRollEvent,'), index.indexOf('onHostClientReady: ({ stop, retire, survivesUpdate })'))
    expect(wiring).toMatch(/sessionSignals,/)
  })

  it('gives it the Host client', () => {
    expect(ipc).toMatch(/hostWiring\?\.sessionSignals\?\.setHost\(\{ status: \(\) => client\.status\(\), send: \(m\) => client\.send\(m\) \}\)/)
  })

  it('tells it every chat event of the app’s adapters, whoever owns Slack', () => {
    const at = ipc.indexOf("send('chat:event', { sessionId, event })")
    expect(at).toBeGreaterThan(0)
    const after = ipc.slice(at, at + 2500)
    expect(after).toMatch(/hostWiring\?\.sessionSignals\?\.chat\(/)
    expect(after.indexOf('sessionSignals?.chat(')).toBeLessThan(after.indexOf('slack?.ownership.local()'))
  })

  it('tells it the roll states of the app’s own chains only', () => {
    const at = index.indexOf('sessionSignals.rollState(')
    expect(at).toBeGreaterThan(0)
    expect(index.slice(at - 400, at)).toMatch(/if \(opts\.orchestration && channel === 'session:rollState'\)/)
  })
})
