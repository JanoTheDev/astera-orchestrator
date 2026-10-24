import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleCommand, type HostSession, type OrchServerDeps, type SessionCreate } from '../orchestration/command'
import { emptyState, type OrchState } from '../orchestration/state'
import { CONSOLE_BRIEF } from './brief'
import { CONSOLE_TITLE, consoleIdStore, ensureConsole, type ConsoleDeps } from './console'

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
