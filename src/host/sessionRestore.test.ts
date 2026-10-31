import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  carryTranscript,
  chatRespawnOf,
  handoverFileIn,
  handoverOf,
  leftBehind,
  readSavedSessions,
  restoreHandover,
  restoreSessions,
  roleOf,
  sessionRestoreFileIn,
  sessionsLeftBehind,
  trackLiveSessions,
  workingTaskCount,
  conversationOnDisk,
  handedOverWorkers,
  liftRestartHold,
  restartFeedLine,
  restartWaitingOn,
  RESTART_RESUME_LINE,
  withoutResumed,
  writeCleanExit,
  writeHandover,
  type HandoverChat,
  type RestoreDeps,
  type SavedSession
} from './sessionRestore'
import { buildClaudeCommand, LAUNCH_FORBIDDEN } from '../core/sessions/commands'
import { readStartHold, writeStartHold } from '../core/orchestration/startHold'
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
    reg.open('pty-1', meta('sess-1', { accountId: 'acc_1', cwd: '/w/a', title: 'A', startedAt: 7_000 }))
    reg.open('pty-2', { kind: 'terminal', id: 'shell', restore: { cwd: '/w' } }) // a plain shell tab: not kept
    reg.note('pty-1', { codexSessionId: 'native-1' })
    await t.flushed()
    expect(await readSavedSessions(file)).toEqual([
      { sessionId: 'sess-old', accountId: 'acc_1', cwd: '/w/old' },
      { sessionId: 'sess-1', accountId: 'acc_1', cwd: '/w/a', title: 'A', nativeSessionId: 'native-1', startedAt: 7_000 }
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

  it('keeps the saved sessions a restore has not settled yet, and drops each once its respawn is done', async () => {
    const file = sessionRestoreFileIn(dir)
    const reg = fakeRegistry()
    const saved: SavedSession[] = [
      { sessionId: 'tab-1', accountId: 'acc_1', cwd: '/w/a', nativeSessionId: 'n-1' },
      { sessionId: 'tab-2', accountId: 'acc_1', cwd: '/w/b', nativeSessionId: 'n-2' }
    ]
    const t = trackLiveSessions({ registry: reg, file, pending: saved, nativeIdOf: async () => null, log: () => {}, pollMs: 60_000 })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const restoring = restoreSessions({
      saved,
      state: null,
      nativeIdOf: async () => null,
      createSession: async (o) => {
        if (o.cwd === '/w/a') {
          await gate // the first respawn is still pending: a crash here must not lose either tab
          reg.open('pty-new-1', meta('new-1', { accountId: 'acc_1', cwd: '/w/a' }))
          return { id: 'new-1' }
        }
        throw new Error('no account') // the second respawn fails for good
      },
      handle: async () => ({ status: 200, body: {} }),
      settle: (sid) => t.settle(sid),
      log: () => {}
    })
    await t.flushed()
    expect((await readSavedSessions(file)).map((x) => x.sessionId)).toEqual(['tab-1', 'tab-2'])
    release()
    await restoring
    await t.flushed()
    expect((await readSavedSessions(file)).map((x) => x.sessionId)).toEqual(['new-1'])
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
    settle: () => {},
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

  it('starts a console fresh, in its folder, when its conversation was never written (no transcript to resume)', async () => {
    const { deps, created } = restoreDeps({
      saved: [
        { sessionId: 'typed', accountId: 'acc_1', cwd: '/w/a', nativeSessionId: 'n-typed' },
        { sessionId: 'untyped', accountId: 'acc_1', cwd: '/w/b', nativeSessionId: 'n-empty', startedAt: 9_000 }
      ],
      hasConversation: async (_acc, id) => id === 'n-typed',
      handover: true
    })
    expect(await restoreSessions(deps)).toEqual({ tabs: 2, planners: 0 })
    expect(created).toEqual([
      { accountId: 'acc_1', cwd: '/w/a', rollAccountIds: [], resumeSessionId: 'n-typed', autoAccounts: true, sessionId: 'typed' },
      { accountId: 'acc_1', cwd: '/w/b', rollAccountIds: [], autoAccounts: true, sessionId: 'untyped', startedAt: 9_000 }
    ])
  })

  it('finds a claude conversation under any claude account; a codex one is always resumable', async () => {
    const accounts = [
      { id: 'acc_1', label: 'a', configDir: '/cfg/1', provider: 'claude' },
      { id: 'acc_2', label: 'b', configDir: '/cfg/2', provider: 'claude' },
      { id: 'acc_cx', label: 'c', configDir: '/cfg/cx', provider: 'codex' }
    ] as Account[]
    const find = async (dir: string, id: string) => (dir === '/cfg/2' && id === 'n-1' ? '/cfg/2/projects/x/n-1.jsonl' : null)
    expect(await conversationOnDisk(accounts, 'acc_1', 'n-1', find)).toBe(true)
    expect(await conversationOnDisk(accounts, 'acc_1', 'n-none', find)).toBe(false)
    expect(await conversationOnDisk(accounts, 'acc_cx', 'th-1', find)).toBe(true)
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

describe('the handover (a resume retire)', () => {
  const BASE = { PATH: '/usr/bin', HOME: '/home/me' }
  /** What the leaving Host holds: a person's tab, a worker done with its Task, a shell, a run, and an agent session's own
   *  pty spawn (kept by the session list, not here). */
  const leaving = () => {
    const state = crashed()
    state.dispatches.push({ ...state.dispatches[0], id: 'dsp_done', sessionId: 'worker-done', endedAt: NOW, outcome: 'succeeded' } as never)
    return handoverOf({
      sessions: [
        { sessionId: 'tab-1', accountId: 'acc_1', cwd: '/w/a', title: 'A', nativeSessionId: 'n-1', startedAt: 5_000 },
        { sessionId: 'worker-done', accountId: 'acc_1', cwd: '/w/wt', nativeSessionId: 'n-w' }
      ],
      ptys: [
        {
          file: '/bin/zsh',
          args: ['-l'],
          opts: { cwd: '/w/a', cols: 100, rows: 40, env: { ...BASE, TERM_PROGRAM: 'astera' } },
          meta: { kind: 'terminal', id: 'term-1', restore: { projectPath: '/w/a' } }
        },
        {
          file: '/bin/sh',
          args: ['-c', 'npm run dev'],
          opts: { cwd: '/w/r/web', cols: 120, rows: 30, env: { ...BASE, PORT: '3000' } },
          meta: { kind: 'run', id: 'run-1', restore: { projectPath: '/w/r', configId: 'cfg-dev', cwd: '/w/r/web', command: 'npm run dev' } }
        },
        { file: 'claude', args: [], opts: { cwd: '/w/a', cols: 80, rows: 24, env: BASE }, meta: meta('tab-1', { accountId: 'acc_1', cwd: '/w/a' }) }
      ],
      // The live line processes' notes: a claude chat and a codex chat, as ChatSessionManager.spawn wrote them, and two
      // that are not chats it could bring back.
      procs: [
        {
          kind: 'chat',
          id: 'chat-cl',
          restore: { accountId: 'acc_1', cwd: '/w/a', title: 'Ask', provider: 'claude', bypassPermissions: false, threadId: 'th-cl', unattendedPermission: 'deny-after-60s', chosenModel: 'opus', startedAt: 1_000, rollAccountIds: ['acc_1', 'acc_2'], bypassedToolchain: true, answered: ['r1'] }
        },
        { kind: 'chat', id: 'chat-cx', restore: { accountId: 'acc_cx', cwd: '/w/b', title: 'B', provider: 'codex', threadId: 'th-cx', unattendedPermission: 'hold', startedAt: 2_000, slackNotify: true } },
        { kind: 'chat', id: 'chat-broken', restore: { cwd: '/w/a' } },
        null
      ],
      state,
      baseEnv: BASE
    })
  }

  it('lists the agent sessions with their Dispatch, the shell terminals and the run configurations, each with only the env that differs', () => {
    const h = leaving()
    expect(h.sessions).toEqual([
      { sessionId: 'tab-1', accountId: 'acc_1', cwd: '/w/a', title: 'A', nativeSessionId: 'n-1', startedAt: 5_000 },
      { sessionId: 'worker-done', accountId: 'acc_1', cwd: '/w/wt', nativeSessionId: 'n-w', dispatchId: 'dsp_done' }
    ])
    expect(h.ptys).toEqual([
      { meta: { kind: 'terminal', id: 'term-1', restore: { projectPath: '/w/a' } }, file: '/bin/zsh', args: ['-l'], cwd: '/w/a', cols: 100, rows: 40, env: { TERM_PROGRAM: 'astera' } },
      {
        meta: { kind: 'run', id: 'run-1', restore: { projectPath: '/w/r', configId: 'cfg-dev', cwd: '/w/r/web', command: 'npm run dev' } },
        file: '/bin/sh',
        args: ['-c', 'npm run dev'],
        cwd: '/w/r/web',
        cols: 120,
        rows: 30,
        env: { PORT: '3000' }
      }
    ])
  })

  it('lists each chat with its thread, title, account, model, policy, chain and startedAt, and skips a note it cannot read', () => {
    expect(leaving().chats).toEqual([
      { sessionId: 'chat-cl', accountId: 'acc_1', cwd: '/w/a', threadId: 'th-cl', title: 'Ask', model: 'opus', unattendedPermission: 'deny-after-60s', startedAt: 1_000, rollAccountIds: ['acc_1', 'acc_2'], bypassPermissions: false, startWithBypass: true },
      { sessionId: 'chat-cx', accountId: 'acc_cx', cwd: '/w/b', threadId: 'th-cx', title: 'B', unattendedPermission: 'hold', startedAt: 2_000, slackNotify: true }
    ])
  })

  it('respawns a chat on its thread under its own id, keeping what it had', () => {
    const account = { id: 'acc_1', label: 'a', configDir: '/cfg/acc_1', provider: 'claude' } as Account
    const [cl] = leaving().chats!
    expect(chatRespawnOf(cl, account)).toEqual({
      sessionId: 'chat-cl',
      account,
      cwd: '/w/a',
      resumeSessionId: 'th-cl',
      title: 'Ask',
      model: 'opus',
      unattendedPermission: 'deny-after-60s',
      startedAt: 1_000,
      rollAccountIds: ['acc_1', 'acc_2'],
      bypassPermissions: false,
      startWithBypass: true
    })
    // A chat that never had a thread starts fresh, still under its own id.
    expect(chatRespawnOf({ sessionId: 'c', accountId: 'acc_1', cwd: '/w' }, account)).toEqual({ sessionId: 'c', account, cwd: '/w' })
  })

  it('brings the handover back in the next Host under the same ids, in the same folders, and then removes the file', async () => {
    writeHandover(dir, leaving())
    const left = await leftBehind(dir)
    expect(left.saved).toEqual([]) // the handover is the list: the crash list is not brought back beside it
    const opened: unknown[] = []
    const respawned: HandoverChat[] = []
    const { deps, created } = restoreDeps({})
    const r = await restoreHandover({
      ...deps,
      file: handoverFileIn(dir),
      handover: left.handover!,
      baseEnv: { PATH: '/bin' },
      openPty: (o) => void opened.push(o),
      respawnChat: async (c) => {
        if (c.sessionId === 'chat-cx') throw new Error('unknown account: acc_cx')
        respawned.push(c)
      }
    })
    // A chat that cannot be respawned is logged and passed; the others still come back.
    expect(r).toEqual({ tabs: 2, planners: 0, ptys: 2, chats: 1 })
    expect(respawned.map((c) => [c.sessionId, c.threadId])).toEqual([['chat-cl', 'th-cl']])
    expect(created).toEqual([
      { accountId: 'acc_1', cwd: '/w/a', title: 'A', rollAccountIds: [], resumeSessionId: 'n-1', autoAccounts: true, sessionId: 'tab-1', startedAt: 5_000 },
      { accountId: 'acc_1', cwd: '/w/wt', rollAccountIds: [], resumeSessionId: 'n-w', autoAccounts: true, sessionId: 'worker-done' }
    ])
    expect(buildClaudeCommand('linux', () => null)({ resumeSessionId: created[0].resumeSessionId }).args).toEqual(expect.arrayContaining(['--resume', 'n-1']))
    expect(opened).toEqual([
      { file: '/bin/zsh', args: ['-l'], opts: { cwd: '/w/a', cols: 100, rows: 40, env: { PATH: '/bin', TERM_PROGRAM: 'astera' } }, meta: { kind: 'terminal', id: 'term-1', restore: { projectPath: '/w/a' } } },
      {
        file: '/bin/sh',
        args: ['-c', 'npm run dev'],
        opts: { cwd: '/w/r/web', cols: 120, rows: 30, env: { PATH: '/bin', PORT: '3000' } },
        meta: { kind: 'run', id: 'run-1', restore: { projectPath: '/w/r', configId: 'cfg-dev', cwd: '/w/r/web', command: 'npm run dev' } }
      }
    ])
    await expect(fs.access(handoverFileIn(dir))).rejects.toThrow()
    expect((await leftBehind(dir)).handover).toBeNull()
  })

  it('leaves a worker still holding an open Dispatch to the recovery and a coordinator to its Run, as a crash does', async () => {
    const { deps, created } = restoreDeps({})
    const handover = { sessions: ['worker-1', 'coord-1'].map((sessionId) => ({ sessionId, accountId: 'acc_1', cwd: '/w', nativeSessionId: `n-${sessionId}` })), ptys: [] }
    expect(await restoreHandover({ ...deps, file: handoverFileIn(dir), handover, baseEnv: {}, openPty: () => {}, respawnChat: async () => {} })).toEqual({ tabs: 0, planners: 0, ptys: 0, chats: 0 })
    expect(created).toEqual([])
  })

  it('goes on past a pty that cannot be reopened', async () => {
    const { deps } = restoreDeps({})
    const pty = leaving().ptys[0]
    const r = await restoreHandover({
      ...deps,
      file: handoverFileIn(dir),
      handover: { sessions: [], ptys: [{ ...pty, cwd: '/gone' }, pty] },
      baseEnv: {},
      openPty: (o) => {
        if (o.opts.cwd === '/gone') throw new Error('no such folder')
      },
      respawnChat: async () => {}
    })
    expect(r.ptys).toBe(1)
  })

  it('keeps the crash restore as it was when no handover was left', async () => {
    const file = sessionRestoreFileIn(dir)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const saved: SavedSession[] = [{ sessionId: 'sess-1', accountId: 'acc_1', cwd: '/w/a', nativeSessionId: 'n-1' }]
    await fs.writeFile(file, JSON.stringify(saved))
    expect(await leftBehind(dir)).toEqual({ handover: null, saved })
    writeCleanExit(dir)
    expect(await leftBehind(dir)).toEqual({ handover: null, saved: [] })
    // A handover beside an unclean marker-less exit wins: the same sessions are not brought back twice
    writeHandover(dir, { sessions: saved, ptys: [] })
    // An older Host's handover has no chats: read as none
    expect(await leftBehind(dir)).toEqual({ handover: { sessions: saved, ptys: [], chats: [] }, saved: [] })
  })
})

describe('workingTaskCount', () => {
  it('counts the Tasks a handover would cut short: a worker, a check, a review or a merge', () => {
    const task = (id: string, status: string) => ({ id, status }) as OrchState['tasks'][number]
    const base = crashed()
    const s = {
      ...base,
      tasks: ['pending', 'ready', 'dispatched', 'validating', 'reviewing', 'merging', 'completed', 'failed', 'blocked'].map((st, i) => task(`t${i}`, st)),
      dispatches: [{ ...base.dispatches[0], id: 'dsp_t2', taskId: 't2' }]
    }
    expect(workingTaskCount(s)).toBe(4)
    expect(workingTaskCount(null)).toBe(0)
  })

  it('does not count a paused plan\'s dispatched Task, whose Dispatch the pause closed', () => {
    const base = crashed()
    const paused = {
      ...base,
      tasks: [{ id: 't1', status: 'dispatched' } as OrchState['tasks'][number]],
      dispatches: [{ ...base.dispatches[0], id: 'dsp_p', taskId: 't1', workerState: 'stopped', endedAt: NOW, closedBy: 'pause' } as OrchState['dispatches'][number]]
    }
    expect(workingTaskCount(paused)).toBe(0)
  })

  it('counts a plan\'s replan in flight: its planner session would not come back', () => {
    const base = crashed()
    const job = { ...base.jobs[0], replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 1, startedAt: NOW, sessionId: 'replan-1' } } as OrchState['jobs'][number]
    expect(workingTaskCount({ ...base, tasks: [], dispatches: [], jobs: [job] })).toBe(1)
    expect(workingTaskCount({ ...base, tasks: [], dispatches: [], jobs: [job] }, (id) => id === 'replan-1')).toBe(1)
    expect(workingTaskCount({ ...base, tasks: [], dispatches: [], jobs: [{ ...job, archivedAt: NOW }] })).toBe(0)
    // a replan whose planner already died (a crash, an older swap) holds nothing back
    expect(workingTaskCount({ ...base, tasks: [], dispatches: [], jobs: [job] }, () => false)).toBe(0)
  })
})

describe('a restart (T13): working Tasks are handed over too', () => {
  /** Two workers mid-Task (their Dispatches open), a worker done with its Task, and a person's tab. */
  const working = (): OrchState => {
    const s = crashed()
    const d = s.dispatches[0]
    return {
      ...s,
      tasks: [
        { id: 'tsk_1', status: 'dispatched' },
        { id: 'tsk_2', status: 'dispatched' },
        { id: 'tsk_3', status: 'completed' }
      ] as OrchState['tasks'],
      dispatches: [
        d,
        { ...d, id: 'dsp_2', taskId: 'tsk_2', sessionId: 'worker-2', cwd: '/w/wt2' },
        { ...d, id: 'dsp_3', taskId: 'tsk_3', sessionId: 'worker-done', endedAt: NOW, outcome: 'succeeded' }
      ] as OrchState['dispatches']
    }
  }
  const rows: SavedSession[] = [
    { sessionId: 'worker-1', accountId: 'acc_1', cwd: '/w/wt', title: 'T1', nativeSessionId: 'n-w1' },
    { sessionId: 'worker-2', accountId: 'acc_2', cwd: '/w/wt2', nativeSessionId: 'n-w2', rollAccountIds: ['acc_2', 'acc_3'] },
    { sessionId: 'worker-done', accountId: 'acc_1', cwd: '/w/wt3', nativeSessionId: 'n-wd' },
    { sessionId: 'tab-1', accountId: 'acc_1', cwd: '/w/a', nativeSessionId: 'n-t1' }
  ]
  const leaving = (restart: boolean) => handoverOf({ sessions: rows, ptys: [], procs: [], state: working(), baseEnv: {}, restart })

  it('marks every session whose Dispatch is still open working, and says it is a restart', () => {
    const h = leaving(true)
    expect(h.restart).toBe(true)
    expect(h.sessions.map((x) => [x.sessionId, x.dispatchId, x.working])).toEqual([
      ['worker-1', 'dsp_1', true],
      ['worker-2', 'dsp_2', true],
      ['worker-done', 'dsp_3', undefined],
      ['tab-1', undefined, undefined]
    ])
    // The automatic swap marks nothing, as before
    const swap = leaving(false)
    expect(swap.restart).toBeUndefined()
    expect(swap.sessions.some((x) => x.working)).toBe(false)
  })

  it('keeps the marks on disk, and the next Host reads which workers it resumes before anything loads', async () => {
    writeHandover(dir, leaving(true))
    expect(handedOverWorkers(dir)).toEqual(['worker-1', 'worker-2'])
    const left = await leftBehind(dir)
    expect(left.handover?.restart).toBe(true)
    expect(left.handover?.sessions.filter((x) => x.working).map((x) => x.sessionId)).toEqual(['worker-1', 'worker-2'])
    // An automatic swap's handover, a torn one and none resume no worker mid-Task
    writeHandover(dir, leaving(false))
    expect(handedOverWorkers(dir)).toEqual([])
    await fs.writeFile(handoverFileIn(dir), '{ torn')
    expect(handedOverWorkers(dir)).toEqual([])
    await fs.rm(handoverFileIn(dir))
    expect(handedOverWorkers(dir)).toEqual([])
  })

  it('resumes both working workers under their own ids on their own accounts, typing the line into each once', async () => {
    writeHandover(dir, leaving(true))
    const left = await leftBehind(dir)
    const lost: string[] = []
    const { deps, created } = restoreDeps({ state: working(), lostWorker: (sid) => void lost.push(sid) })
    const r = await restoreHandover({ ...deps, file: handoverFileIn(dir), handover: left.handover!, baseEnv: {}, openPty: () => {}, respawnChat: async () => {} })
    expect(r).toEqual({ tabs: 4, planners: 0, ptys: 0, chats: 0 })
    expect(lost).toEqual([])
    expect(created).toEqual([
      { accountId: 'acc_1', cwd: '/w/wt', title: 'T1', rollAccountIds: [], resumeSessionId: 'n-w1', autoAccounts: false, sessionId: 'worker-1', initialPrompt: RESTART_RESUME_LINE },
      { accountId: 'acc_2', cwd: '/w/wt2', rollAccountIds: ['acc_2', 'acc_3'], resumeSessionId: 'n-w2', autoAccounts: false, sessionId: 'worker-2', initialPrompt: RESTART_RESUME_LINE },
      // Done with its Task, and a person's tab: as the automatic swap brings them back, with nothing typed in
      { accountId: 'acc_1', cwd: '/w/wt3', rollAccountIds: [], resumeSessionId: 'n-wd', autoAccounts: true, sessionId: 'worker-done' },
      { accountId: 'acc_1', cwd: '/w/a', rollAccountIds: [], resumeSessionId: 'n-t1', autoAccounts: true, sessionId: 'tab-1' }
    ])
    expect(created.filter((c) => c.initialPrompt === RESTART_RESUME_LINE).map((c) => c.sessionId)).toEqual(['worker-1', 'worker-2'])
    // ...which the launch turns into the resume with the line as its one prompt
    const args = buildClaudeCommand('linux', () => null)({ resumeSessionId: 'n-w1', initialPrompt: created[0].initialPrompt }).args
    expect(args.slice(-4)).toEqual(['--resume', 'n-w1', '--', RESTART_RESUME_LINE])
    expect(args.filter((a) => a === RESTART_RESUME_LINE)).toHaveLength(1)
    // win32 starts it through cmd.exe: the line carries nothing a launch line must not (commands.ts)
    expect(LAUNCH_FORBIDDEN.test(RESTART_RESUME_LINE)).toBe(false)
  })

  it('hands a working worker it cannot resume to the recovery instead of starting it blank', async () => {
    const handover = {
      sessions: [
        { sessionId: 'worker-1', accountId: 'acc_1', cwd: '/w/wt', working: true as const }, // no conversation id at all
        { sessionId: 'worker-2', accountId: 'acc_2', cwd: '/w/wt2', nativeSessionId: 'never-written', working: true as const }
      ],
      ptys: [],
      restart: true as const
    }
    const lost: string[] = []
    const { deps, created } = restoreDeps({ state: working(), lostWorker: (sid) => void lost.push(sid), hasConversation: async () => false })
    await restoreHandover({ ...deps, file: handoverFileIn(dir), handover, baseEnv: {}, openPty: () => {}, respawnChat: async () => {} })
    expect(created).toEqual([])
    expect(lost).toEqual(['worker-1', 'worker-2'])

    // A spawn that fails is the recovery's too
    const failed: string[] = []
    const again = restoreDeps({
      state: working(),
      nativeIdOf: async () => 'n-1',
      lostWorker: (sid) => void failed.push(sid),
      createSession: async () => {
        throw new Error('CWD_MISSING: /w/wt')
      }
    })
    await restoreHandover({
      ...again.deps,
      file: handoverFileIn(dir),
      handover: { ...handover, sessions: [handover.sessions[0]] },
      baseEnv: {},
      openPty: () => {},
      respawnChat: async () => {}
    })
    expect(failed).toEqual(['worker-1'])
  })

  it('brings back a worker that reported in the last moment as a tab, with nothing typed in', async () => {
    const s = working()
    const reported = { ...s, dispatches: s.dispatches.map((d) => (d.id === 'dsp_1' ? { ...d, endedAt: NOW, outcome: 'succeeded' as const } : d)) }
    const { deps, created } = restoreDeps({ state: reported })
    await restoreSessions({ ...deps, saved: [{ ...rows[0], working: true } as SavedSession], handover: true })
    expect(created).toEqual([{ accountId: 'acc_1', cwd: '/w/wt', title: 'T1', rollAccountIds: [], resumeSessionId: 'n-w1', autoAccounts: true, sessionId: 'worker-1' }])
  })

  it('keeps crash resume from waiting on the workers the handover resumes', () => {
    const s = working()
    expect(withoutResumed(s, new Set(['worker-1']))!.dispatches.map((d) => d.id)).toEqual(['dsp_2', 'dsp_3'])
    expect(withoutResumed(s, new Set())).toBe(s)
    expect(withoutResumed(null, new Set(['worker-1']))).toBeNull()
  })

  it('lifts a restart’s hold once the sessions are back, and keeps an owner’s', async () => {
    await writeStartHold(dir, { by: 'restart', reason: 'r', at: NOW })
    // Not while this Host is restarting itself
    expect(await liftRestartHold(dir, () => true)).toBe(false)
    expect(await readStartHold(dir)).not.toBeNull()
    expect(await liftRestartHold(dir, () => false)).toBe(true)
    expect(await readStartHold(dir)).toBeNull()
    await writeStartHold(dir, { by: 'owner', reason: 'moving', at: NOW })
    expect(await liftRestartHold(dir, () => false)).toBe(false)
    expect(await readStartHold(dir)).toEqual({ by: 'owner', reason: 'moving', at: NOW })
  })

  it('says what it did in the feed', () => {
    expect(restartFeedLine('1.4.2', 3)).toBe('Host restarted to 1.4.2: 3 sessions resumed')
    expect(restartFeedLine('1.4.2', 1)).toBe('Host restarted to 1.4.2: 1 session resumed')
  })
})

describe('restartWaitingOn (the safe point)', () => {
  const task = (id: string, status: string) => ({ id, status }) as OrchState['tasks'][number]
  const at = (over: Partial<OrchState['dispatches'][number]>) => ({ ...crashed().dispatches[0], ...over }) as OrchState['dispatches'][number]
  const state = (): OrchState => ({
    ...crashed(),
    tasks: [
      task('t_busy', 'dispatched'),
      task('t_idle', 'dispatched'),
      task('t_unknown', 'dispatched'),
      task('t_gone', 'dispatched'),
      task('t_starting', 'dispatched'),
      task('t_check', 'validating'),
      task('t_review', 'reviewing'),
      task('t_merge', 'merging'),
      task('t_done', 'completed'),
      task('t_paused', 'dispatched')
    ],
    dispatches: [
      at({ id: 'd1', taskId: 't_busy', sessionId: 's-busy' }),
      at({ id: 'd2', taskId: 't_idle', sessionId: 's-idle' }),
      at({ id: 'd3', taskId: 't_unknown', sessionId: 's-unknown' }),
      at({ id: 'd4', taskId: 't_gone', sessionId: 's-gone' }),
      at({ id: 'd5', taskId: 't_starting', sessionId: 'pending:abc' }),
      at({ id: 'd6', taskId: 't_review', sessionId: 's-reviewer' }),
      at({ id: 'd7', taskId: 't_paused', sessionId: 's-busy-2', endedAt: NOW, closedBy: 'pause' })
    ]
  })
  const probe = {
    alive: (id: string) => id !== 's-gone',
    busy: (id: string): boolean | null => (id === 's-busy' || id === 's-busy-2' ? true : id === 's-unknown' ? null : false)
  }

  it('waits on a busy worker, one whose screen never said, a start in flight, and a check or merge the Host runs', () => {
    expect(restartWaitingOn(state(), probe)).toEqual(['t_busy', 't_unknown', 't_starting', 't_check', 't_merge'])
    expect(restartWaitingOn(null, probe)).toEqual([])
  })

  it('goes on once each worker is idle at its prompt or has reported', () => {
    const s = state()
    const settled: OrchState = {
      ...s,
      tasks: s.tasks.map((t) => (['t_check', 't_merge', 't_starting'].includes(t.id) ? { ...t, status: 'completed' } : t)) as OrchState['tasks']
    }
    const idle = { alive: probe.alive, busy: (): boolean | null => false }
    expect(restartWaitingOn(settled, idle)).toEqual([])
    // A reviewer busy at its review is waited for like a worker
    expect(restartWaitingOn(settled, { alive: probe.alive, busy: (id) => id === 's-reviewer' })).toEqual(['t_review'])
  })

  it('waits on a replan whose planner is busy or still starting, by its Job', () => {
    const base = crashed()
    const job = { ...base.jobs[0], replanning: { runId: 'run_1', mode: 'completion', wave: 1, done: 1, startedAt: NOW, sessionId: 'replan-1' } } as OrchState['jobs'][number]
    const s = { ...base, tasks: [], dispatches: [], jobs: [job] }
    expect(restartWaitingOn(s, { alive: () => true, busy: () => true })).toEqual([job.id])
    expect(restartWaitingOn(s, { alive: () => true, busy: () => false })).toEqual([])
    expect(restartWaitingOn(s, { alive: () => false, busy: () => null })).toEqual([])
    const starting = { ...s, jobs: [{ ...job, replanning: { ...job.replanning!, sessionId: undefined } }] }
    expect(restartWaitingOn(starting, { alive: () => false, busy: () => null })).toEqual([job.id])
  })
})
