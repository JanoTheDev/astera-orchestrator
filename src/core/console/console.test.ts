import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps, type SessionCreate } from '../orchestration/command'
import { emptyState, type OrchState } from '../orchestration/state'
import { CONSOLE_BRIEF } from './brief'
import { CONSOLE_TITLE, consoleIdStore, ensureChat, ensureConsole, isChatSession, type ConsoleDeps } from './console'
import { planChatBrief } from '../orchestration/planChatBrief'
import type { Job } from '../orchestration/types'

const row = (id: string, alive: boolean, extra: Partial<HostSession> = {}): HostSession => ({
  id,
  kind: 'chat',
  title: CONSOLE_TITLE,
  accountId: 'a1',
  cwd: '/profile',
  alive,
  state: 'unknown',
  ...extra
})

/** A Host with a session list and a starter that adds a live row, and an id store in memory. */
function fakes(start: HostSession[] = [], stored: string | null = null) {
  const sessions = [...start]
  const created: SessionCreate[] = []
  let id = stored
  let n = 0
  const deps: ConsoleDeps = {
    cwd: '/profile',
    list: async () => sessions,
    create: async (o) => {
      created.push(o)
      const r = row(`s${++n}`, true)
      sessions.push(r)
      return r
    },
    store: { read: async () => id, write: async (v) => void (id = v) }
  }
  return { deps, sessions, created, storedId: () => id }
}

describe('ensureConsole', () => {
  it('creates a chat session in the profile dir with the brief once, then reuses it', async () => {
    const f = fakes()
    const first = await ensureConsole(f.deps)
    expect(f.created).toEqual([{ kind: 'chat', cwd: '/profile', title: CONSOLE_TITLE, prompt: CONSOLE_BRIEF, rollAccountIds: [], unattended: 'hold' }])
    expect(f.storedId()).toBe(first.id)
    const again = await ensureConsole(f.deps)
    expect(again.id).toBe(first.id)
    expect(f.created).toHaveLength(1)
  })

  it('recreates the console after its session ended', async () => {
    const f = fakes([row('old', false)], 'old')
    const r = await ensureConsole(f.deps)
    expect(r.id).not.toBe('old')
    expect(f.created).toHaveLength(1)
    expect(f.storedId()).toBe(r.id)
  })

  it('recreates the console when the stored session is gone from the list', async () => {
    const f = fakes([], 'gone')
    const r = await ensureConsole(f.deps)
    expect(f.created).toHaveLength(1)
    expect(f.storedId()).toBe(r.id)
  })

  it('follows an account roll to the live session and stores its id', async () => {
    const f = fakes([row('c1', false), row('c2', false, { rolledFrom: 'c1' }), row('c3', true, { rolledFrom: 'c2' })], 'c1')
    const r = await ensureConsole(f.deps)
    expect(r.id).toBe('c3')
    expect(f.created).toHaveLength(0)
    expect(f.storedId()).toBe('c3')
  })

  it('starts one session for two calls at once', async () => {
    const f = fakes()
    const [a, b] = await Promise.all([ensureConsole(f.deps), ensureConsole(f.deps)])
    expect(a.id).toBe(b.id)
    expect(f.created).toHaveLength(1)
  })
})

describe('consoleIdStore', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the id in the profile dir across stores (a Host restart)', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'console-'))
    expect(await consoleIdStore(dir).read()).toBeNull()
    await consoleIdStore(dir).write('s9')
    expect(await consoleIdStore(dir).read()).toBe('s9')
  })
})

describe('console-ensure', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const deps = (extra: Partial<OrchServerDeps>): OrchServerDeps => {
    const box = { state: emptyState() }
    return {
      getState: () => box.state,
      setState: async (next: OrchState) => void (box.state = next),
      listAccounts: () => [],
      now: () => '2026-10-24T00:00:00.000Z',
      ...extra
    } as unknown as OrchServerDeps
  }

  it('answers the console session from the Host and starts it in the profile dir once', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'console-'))
    const f = fakes()
    const d = deps({ profileDir: dir, listSessions: f.deps.list, createSession: f.deps.create })
    const a = await handleCommand(d, { sessionId: '' }, 'console-ensure', {})
    const b = await handleCommand(d, { sessionId: '' }, 'console-ensure', {})
    expect(a.status).toBe(200)
    expect((b.body as HostSession).id).toBe((a.body as HostSession).id)
    expect(f.created).toHaveLength(1)
    expect(f.created[0].cwd).toBe(dir)
  })

  it('is refused by a caller that is not the Host (409)', async () => {
    expect((await handleCommand(deps({}), { sessionId: '' }, 'console-ensure', {})).status).toBe(409)
  })
})

describe('ensureChat', () => {
  it('keeps two chats apart: each key starts its own session', async () => {
    const f = fakes()
    let a: string | null = null
    let b: string | null = null
    const chat = (key: string, get: () => string | null, set: (v: string) => void) =>
      ensureChat({ ...f.deps, key, title: key, prompt: 'p', store: { read: async () => get(), write: async (v) => set(v) } })
    const [x, y] = await Promise.all([chat('job_a', () => a, (v) => (a = v)), chat('job_b', () => b, (v) => (b = v))])
    expect(x.id).not.toBe(y.id)
    expect(f.created.map((c) => c.title)).toEqual(['job_a', 'job_b'])
  })
})

describe('isChatSession', () => {
  const rows = [row('c1', false), row('c2', true, { rolledFrom: 'c1' }), row('x', true)]
  it('is the chat itself or a session rolled from it', () => {
    expect(isChatSession(rows, 'c1', 'c1')).toBe(true)
    expect(isChatSession(rows, 'c2', 'c1')).toBe(true)
    expect(isChatSession(rows, 'x', 'c1')).toBe(false)
    expect(isChatSession(rows, 'c1', 'c2')).toBe(false)
  })
})

describe('jobs-chat-ensure', () => {
  const job: Job = { id: 'job_1', objective: 'ship it', title: 'Ship', cwd: '/repo', createdAt: '2026-10-24T00:00:00.000Z' }
  const deps = (f: ReturnType<typeof fakes> | null, jobs: Job[] = [job]): { d: OrchServerDeps; state: () => OrchState } => {
    const box = { state: { ...emptyState(), jobs } }
    const d = {
      getState: () => box.state,
      setState: async (next: OrchState) => void (box.state = next),
      listAccounts: () => [],
      now: () => '2026-10-24T00:00:00.000Z',
      ...(f ? { listSessions: f.deps.list, createSession: f.deps.create } : {})
    } as unknown as OrchServerDeps
    return { d, state: () => box.state }
  }

  it("starts the plan's chat in its folder with its brief, keeps the id on the Job and reuses it", async () => {
    const f = fakes()
    const { d, state } = deps(f)
    const a = await handleCommand(d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })
    expect(a.status).toBe(200)
    const id = (a.body as HostSession).id
    expect(f.created).toEqual([{ kind: 'chat', cwd: '/repo', title: 'Plan chat: Ship', prompt: planChatBrief(job), rollAccountIds: [], unattended: 'hold' }])
    expect(state().jobs[0].chatSessionId).toBe(id)
    const b = await handleCommand(d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })
    expect((b.body as HostSession).id).toBe(id)
    expect(f.created).toHaveLength(1)
  })

  it('starts a new chat after the old one ended, and follows a roll', async () => {
    const ended = fakes([row('old', false)])
    const r = deps(ended, [{ ...job, chatSessionId: 'old' }])
    const a = await handleCommand(r.d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })
    expect((a.body as HostSession).id).not.toBe('old')
    expect(ended.created).toHaveLength(1)
    expect(r.state().jobs[0].chatSessionId).toBe((a.body as HostSession).id)

    const rolled = fakes([row('c1', false), row('c2', true, { rolledFrom: 'c1' })])
    const q = deps(rolled, [{ ...job, chatSessionId: 'c1' }])
    expect(((await handleCommand(q.d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })).body as HostSession).id).toBe('c2')
    expect(rolled.created).toHaveLength(0)
    expect(q.state().jobs[0].chatSessionId).toBe('c2')
  })

  it('refuses an unknown job (404), an archived one (409) and a caller that is not the Host (409)', async () => {
    const f = fakes()
    expect((await handleCommand(deps(f).d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'nope' })).status).toBe(404)
    expect((await handleCommand(deps(f, [{ ...job, archivedAt: '2026-10-24T00:00:00.000Z' }]).d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })).status).toBe(409)
    expect((await handleCommand(deps(null).d, { sessionId: '' }, 'jobs-chat-ensure', { id: 'job_1' })).status).toBe(409)
    expect(f.created).toHaveLength(0)
  })
})
