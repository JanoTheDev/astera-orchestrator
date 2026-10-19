import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  carryTranscript,
  readSavedSessions,
  restoreSessions,
  roleOf,
  sessionRestoreFileIn,
  sessionsLeftBehind,
  trackLiveSessions,
  writeCleanExit,
  type RestoreDeps,
  type SavedSession
} from './sessionRestore'
import { buildClaudeCommand } from '../core/sessions/commands'
import { stateFromLegacy } from '../core/orchestration/legacyState'
import type { PtyEntry, PtyMeta } from '../core/host/protocol'
import type { OrchState } from '../core/orchestration/state'
import type { Account } from '../core/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-restore-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const meta = (id: string, restore: Record<string, unknown>): PtyMeta => ({ kind: 'session', id, restore })

/** The registry's four calls the tracker uses, over a plain list. */
function fakeRegistry() {
  const entries: (PtyEntry & { meta: PtyMeta | null })[] = []
  const metaCbs: ((id: string, m: PtyMeta, why: 'open' | 'note') => void)[] = []
  const exitCbs: ((id: string, code: number) => void)[] = []
  return {
    list: () => entries.map((e) => ({ ...e })),
    onMeta: (cb: (id: string, m: PtyMeta, why: 'open' | 'note') => void) => (metaCbs.push(cb), () => {}),
    onExit: (cb: (id: string, code: number) => void) => (exitCbs.push(cb), () => {}),
    metaOf: (id: string) => entries.find((e) => e.id === id)?.meta ?? null,
    sessionPty: (sid: string) => entries.filter((e) => e.alive && e.meta?.id === sid).at(-1)?.id ?? null,
    open(id: string, m: PtyMeta) {
      entries.push({ id, pid: 1, meta: m, alive: true })
      for (const cb of metaCbs) cb(id, m, 'open')
    },
    note(id: string, patch: Record<string, unknown>) {
      const e = entries.find((x) => x.id === id)!
      e.meta = { ...e.meta!, restore: { ...e.meta!.restore, ...patch } }
      for (const cb of metaCbs) cb(id, e.meta, 'note')
    },
    exit(id: string) {
      entries.find((x) => x.id === id)!.alive = false
      for (const cb of exitCbs) cb(id, 0)
    }
  }
}

describe('trackLiveSessions', () => {
  it('adds a session when its pty opens, keeps its conversation id, and removes it when it ends', async () => {
    const file = sessionRestoreFileIn(dir)
    const reg = fakeRegistry()
    reg.open('pty-0', meta('sess-old', { accountId: 'acc_1', cwd: '/w/old' })) // live before the tracker starts
    const t = trackLiveSessions({ registry: reg, file, nativeIdOf: async () => null, log: () => {}, pollMs: 60_000 })
    reg.open('pty-1', meta('sess-1', { accountId: 'acc_1', cwd: '/w/a', title: 'A' }))
    reg.open('pty-2', { kind: 'terminal', id: 'shell', restore: { cwd: '/w' } }) // a plain shell tab: not kept
    reg.note('pty-1', { codexSessionId: 'native-1' })
    await t.flushed()
    expect(await readSavedSessions(file)).toEqual([
      { sessionId: 'sess-old', accountId: 'acc_1', cwd: '/w/old' },
      { sessionId: 'sess-1', accountId: 'acc_1', cwd: '/w/a', title: 'A', nativeSessionId: 'native-1' }
    ])
    reg.exit('pty-1')
    await t.flushed()
    expect((await readSavedSessions(file)).map((x) => x.sessionId)).toEqual(['sess-old'])
    t.dispose()
  })

  it('keeps a rolled session (a new pty under the same id) and, frozen, keeps what the way out kills', async () => {
    const file = sessionRestoreFileIn(dir)
    const reg = fakeRegistry()
    const t = trackLiveSessions({ registry: reg, file, nativeIdOf: async () => null, log: () => {}, pollMs: 60_000 })
    reg.open('pty-1', meta('sess-1', { accountId: 'acc_1', cwd: '/w/a' }))
    reg.open('pty-2', meta('sess-1', { accountId: 'acc_2', cwd: '/w/a' })) // the roll's new pty
    reg.exit('pty-1')
    await t.flushed()
    expect(await readSavedSessions(file)).toEqual([{ sessionId: 'sess-1', accountId: 'acc_2', cwd: '/w/a' }])
    t.freeze()
    reg.exit('pty-2') // killAll on a reboot's SIGTERM
    await t.flushed()
    expect((await readSavedSessions(file)).map((x) => x.sessionId)).toEqual(['sess-1'])
    t.dispose()
  })

  it('learns a claude conversation id from the hook events by polling', async () => {
    const file = sessionRestoreFileIn(dir)
    const reg = fakeRegistry()
    const t = trackLiveSessions({ registry: reg, file, nativeIdOf: async () => 'claude-native', log: () => {}, pollMs: 5 })
    reg.open('pty-1', meta('sess-1', { accountId: 'acc_1', cwd: '/w/a' }))
    await new Promise((r) => setTimeout(r, 40))
    await t.flushed()
    expect((await readSavedSessions(file))[0].nativeSessionId).toBe('claude-native')
    t.dispose()
  })
})

describe('readSavedSessions / sessionsLeftBehind', () => {
  it('survives a torn write: a half-written file reads as nothing, never a throw', async () => {
    const file = sessionRestoreFileIn(dir)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '[{"sessionId":"sess-1","accountId":"acc_1","cw')
    expect(await readSavedSessions(file)).toEqual([])
    expect(await readSavedSessions(path.join(dir, 'missing.json'))).toEqual([])
  })

  it('brings back the saved list after an unclean exit, and nothing after a clean one', async () => {
    const file = sessionRestoreFileIn(dir)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const saved: SavedSession[] = [{ sessionId: 'sess-1', accountId: 'acc_1', cwd: '/w/a', nativeSessionId: 'n-1' }]
    await fs.writeFile(file, JSON.stringify(saved))
    expect(await sessionsLeftBehind(dir)).toEqual(saved) // no marker: a crash
    writeCleanExit(dir)
    expect(await sessionsLeftBehind(dir)).toEqual([]) // a clean exit restores nothing
    expect(await sessionsLeftBehind(dir)).toEqual(saved) // the marker was taken: the next exit is unclean again
  })
})

const NOW = '2026-10-20T10:00:00.000Z'
/** A crash left: a plan awaiting approval with its planner, a Run with a coordinator and a worker. */
const crashed = (): OrchState => {
  const s = stateFromLegacy({
    runs: [{ id: 'run_1', objective: 'o', cwd: '/w/r', createdAt: NOW, autoDispatch: false, coordinatorSessionId: 'coord-1' }],
    dispatches: [
      { id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'acc_1', sessionId: 'worker-1', cwd: '/w/wt', specPath: '', startedAt: NOW, workerState: 'ready', retained: false }
    ]
  } as never)
  const job = (over: object) => ({ objective: 'o', createdAt: NOW, coordinatorAccountId: 'acc_1', ...over }) as OrchState['jobs'][number]
  return {
    ...s,
    jobs: [
      ...s.jobs,
      job({ id: 'job_plan', cwd: '/w/p', pendingStart: true, plannerSessionIds: ['planner-old', 'planner-1'] }),
      job({ id: 'job_done', cwd: '/w/d', plannerSessionIds: ['planner-2'] })
    ]
  }
}

function restoreDeps(over: Partial<RestoreDeps>) {
  const created: Parameters<RestoreDeps['createSession']>[0][] = []
  const handled: Record<string, unknown>[] = []
  const deps: RestoreDeps = {
    saved: [],
    state: crashed(),
    nativeIdOf: async () => null,
    createSession: async (o) => (created.push(o), { id: `new-${created.length}` }),
    handle: async (cmd, args) => (handled.push({ cmd, ...args }), { status: 200, body: {} }),
    log: () => {},
    ...over
  }
  return { deps, created, handled }
}

describe('restoreSessions', () => {
  it('respawns each saved tab with its native resume, in its folder and on its account', async () => {
    const { deps, created } = restoreDeps({
      saved: [
        { sessionId: 'tab-1', accountId: 'acc_1', cwd: '/w/a', title: 'A', nativeSessionId: 'n-1', rollAccountIds: ['acc_1', 'acc_2'] },
        { sessionId: 'tab-2', accountId: 'acc_2', cwd: '/w/b', nativeSessionId: 'stale' },
        { sessionId: 'tab-3', accountId: 'acc_1', cwd: '/w/c' } // no conversation yet: nothing to resume
      ],
      // The hook events still on disk name the latest conversation (after a /clear)
      nativeIdOf: async (sid) => (sid === 'tab-2' ? 'n-2' : null)
    })
    expect(await restoreSessions(deps)).toEqual({ tabs: 2, planners: 0 })
    expect(created).toEqual([
      { accountId: 'acc_1', cwd: '/w/a', title: 'A', rollAccountIds: ['acc_1', 'acc_2'], resumeSessionId: 'n-1', autoAccounts: true },
      { accountId: 'acc_2', cwd: '/w/b', rollAccountIds: [], resumeSessionId: 'n-2', autoAccounts: true }
    ])
    // ...which the spawn turns into the provider's native resume
    expect(buildClaudeCommand('linux', () => null)({ resumeSessionId: created[0].resumeSessionId }).args).toEqual(
      expect.arrayContaining(['--resume', 'n-1'])
    )
  })

  it('resumes the dead planner of a plan awaiting approval, and leaves coordinators, workers and older planners alone', async () => {
    const { deps, created, handled } = restoreDeps({
      saved: ['planner-1', 'planner-old', 'planner-2', 'coord-1', 'worker-1'].map((sessionId) => ({
        sessionId, accountId: 'acc_1', cwd: '/w', nativeSessionId: `n-${sessionId}`
      }))
    })
    expect(await restoreSessions(deps)).toEqual({ tabs: 0, planners: 1 })
    expect(handled).toEqual([{ cmd: 'jobs-plan', id: 'job_plan', resume: 'n-planner-1' }])
    expect(created).toEqual([])
  })

  it('starts a fresh planner through jobs-plan when its conversation is unknown or will not resume', async () => {
    const saved = [{ sessionId: 'planner-1', accountId: 'acc_1', cwd: '/w' }]
    const fresh = restoreDeps({ saved })
    expect(await restoreSessions(fresh.deps)).toEqual({ tabs: 0, planners: 1 })
    expect(fresh.handled).toEqual([{ cmd: 'jobs-plan', id: 'job_plan' }])

    const refused = restoreDeps({
      saved: [{ ...saved[0], nativeSessionId: 'gone' }],
      handle: async (cmd, args) => (refused.handled.push({ cmd, ...args }), { status: args.resume ? 400 : 200, body: {} })
    })
    expect(await restoreSessions(refused.deps)).toEqual({ tabs: 0, planners: 1 })
    expect(refused.handled).toEqual([
      { cmd: 'jobs-plan', id: 'job_plan', resume: 'gone' },
      { cmd: 'jobs-plan', id: 'job_plan' }
    ])
  })

  it('goes on past a tab that cannot be resumed', async () => {
    const { deps } = restoreDeps({
      saved: [
        { sessionId: 'tab-1', accountId: 'gone', cwd: '/w/a', nativeSessionId: 'n-1' },
        { sessionId: 'tab-2', accountId: 'acc_1', cwd: '/w/b', nativeSessionId: 'n-2' }
      ],
      createSession: async (o) => {
        if (o.accountId === 'gone') throw new Error('unknown account: gone')
        return { id: 'new' }
      }
    })
    expect(await restoreSessions(deps)).toEqual({ tabs: 1, planners: 0 })
  })
})

describe('roleOf', () => {
  it('reads each role from the state, a person’s tab being none of them', () => {
    const s = crashed()
    expect(['tab', 'planner-1', 'coord-1', 'worker-1'].map((id) => roleOf(s, id))).toEqual(['user', 'planner', 'coordinator', 'worker'])
    expect(roleOf(null, 'coord-1')).toBe('user')
  })
})

describe('carryTranscript', () => {
  const acc = (id: string, provider: 'claude' | 'codex' = 'claude'): Account => ({ id, label: id, configDir: `/cfg/${id}`, provider }) as Account
  it('copies a claude transcript to the account the resume moved to, and only when it is not there', async () => {
    const files = new Set(['/cfg/acc_1/projects/-w-a/n-1.jsonl'])
    const copies: [string, string][] = []
    const io = {
      find: async (configDir: string, id: string) => [...files].find((f) => f.startsWith(configDir) && f.endsWith(`${id}.jsonl`)) ?? null,
      copy: async (src: string, dest: string) => void copies.push([src, dest])
    }
    await carryTranscript(acc('acc_2'), [acc('acc_1'), acc('acc_2'), acc('cx', 'codex')], 'n-1', io)
    expect(copies).toEqual([['/cfg/acc_1/projects/-w-a/n-1.jsonl', path.join('/cfg/acc_2', 'projects', '-w-a', 'n-1.jsonl')]])
    await carryTranscript(acc('acc_1'), [acc('acc_1'), acc('acc_2')], 'n-1', io) // already there
    expect(copies).toHaveLength(1)
  })
})
