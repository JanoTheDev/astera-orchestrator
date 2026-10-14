// Plugin Phase 3 (events and notifications design N2, N3), the slice end to end: the Host's own hook events, an app's
// forwarded chat and a roll, through the recorder into the real event log on disk, and read back as `events-poll`
// answers them, in the public shape the SDK yields. Only the session rows and the registries are fakes.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHostEventLog, type HostEventLog } from './eventLog'
import { createHostSessionEvents } from './sessionEvents'
import { pollEvents } from './eventsPoll'
import { publicFor } from '../core/publicContract'
import type { HostSession } from '../core/orchestration/command'

const dirs: string[] = []
const logs: HostEventLog[] = []
afterEach(() => {
  for (const l of logs.splice(0)) l.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const build: HostSession = {
  id: 's1',
  kind: 'terminal',
  title: 'Build',
  accountId: 'a1',
  cwd: 'D:\\p',
  alive: true,
  state: 'waiting',
  provider: 'claude',
  sources: { status: 'hooks', prompt: 'hooks', usage: 'statusline', conversation: 'transcript' }
}

describe('session events, from the signals to an SDK page', () => {
  it('reads back what the Host heard and what the app forwarded, shaped as the SDK yields it', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'astera-session-events-'))
    dirs.push(root)
    const log = createHostEventLog({ dir: path.join(root, 'orch'), bootId: '0123456789abcdef0123456789abcdef', now: () => 'T', log: () => {} })
    logs.push(log)
    await log.load()
    const events = createHostSessionEvents({
      record: (drafts) => log.recorded(drafts),
      sessionById: async (id) => (id === 's1' ? build : null),
      registry: { onExit: () => () => {}, metaOf: () => null, sessionPty: () => null },
      procs: { onExit: () => () => {}, list: () => [] },
      chats: { subscribe: () => () => {}, has: () => false },
      rolling: { has: () => false },
      log: () => {}
    })
    events.onHookEvent('s1', { hook_event_name: 'PreToolUse', tool_use_id: 't', tool_name: 'Bash' })
    events.onHookEvent('s1', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' })
    events.forwarded({ kind: 'chat', session: { id: 'c1', kind: 'chat', title: 'Chat' }, event: { type: 'request', request: 'question' } })
    events.forwarded({ kind: 'chat', session: { id: 'c1', kind: 'chat', title: 'Chat' }, event: { type: 'status', status: 'waiting' } })
    events.onRollState({ sessionId: 's2', state: 'waiting', nextRetryAt: 'R' })
    await events.settled()
    await log.flushed()

    // A new Host's log, over the same folder: what the SDK reads after a restart
    const next = createHostEventLog({ dir: path.join(root, 'orch'), bootId: 'ba9876543210fedcba9876543210fedc', now: () => 'T', log: () => {} })
    logs.push(next)
    await next.load()
    const reply = await pollEvents(next, { types: 'session.input_needed,session.limit_waiting', limit: 10 })
    expect(reply.status).toBe(200)
    const page = publicFor('events-poll', reply.body) as { events: unknown[]; gap: boolean }
    expect(page.gap).toBe(false)
    expect(page.events).toEqual([
      { id: 'ev_0123456789ab_1', type: 'session.input_needed', sequence: 1, occurredAt: 'T', sessionId: 's1', payload: { session: { id: 's1', kind: 'terminal', title: 'Build', provider: 'claude', cwd: 'D:\\p' }, prompt: 'permission' } },
      { id: 'ev_0123456789ab_2', type: 'session.input_needed', sequence: 2, occurredAt: 'T', sessionId: 'c1', payload: { session: { id: 'c1', kind: 'chat', title: 'Chat' }, prompt: 'question' } },
      { id: 'ev_0123456789ab_3', type: 'session.limit_waiting', sequence: 3, occurredAt: 'T', sessionId: 's2', payload: { session: { id: 's2', kind: 'terminal' }, nextRetryAt: 'R' } }
    ])
  })
})
