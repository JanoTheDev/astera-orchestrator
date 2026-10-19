import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { CRASH_REASON, CRASH_RESUME_NOTE, crashFeedLine, crashResumeBriefing, resumeAfterCrash } from './crashResume'
import { OrchestrationStore } from '../store'
import { readStateFile } from '../stateFile'
import { readGitSummary } from './gitSummary'
import { readGitFacts } from '../../recovery/git'
import { decideRecovery } from '../../recovery/decide'
import { executeRecovery } from '../../recovery/execute'
import { stateFromLegacy } from '../legacyState'
import type { ActivityDraft } from '../activity'
import type { Dispatch, Task } from '../types'

const NOW = '2026-10-19T10:00:00.000Z'
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

let dir: string
let wt: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crash-resume-'))
  wt = path.join(dir, 'wt')
  await fs.mkdir(wt)
  sh(wt, 'init', '-q')
  sh(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const task = (over: Partial<Task>): Task => ({
  id: 'tsk_x', runId: 'run_1', title: 't', spec: 'do it', deps: [], status: 'dispatched',
  accountIds: ['acc_1'], consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over
})
const dispatch = (over: Partial<Dispatch>): Dispatch => ({
  id: 'dsp_x', taskId: 'tsk_x', provider: 'claude', accountId: 'acc_1', sessionId: 'sess-x',
  cwd: '', specPath: '', startedAt: NOW, workerState: 'ready', retained: false, ...over
})

/** The file a Host killed with -9 mid-plan leaves: T1 finished, T2's worker in flight in its worktree, a coordinator in
 *  the Run's slot. Nothing was closed: the Host had no chance to. */
async function crashedFile(): Promise<string> {
  const file = path.join(dir, 'orchestration.json')
  const s = stateFromLegacy({
    runs: [{ id: 'run_1', objective: 'o', cwd: dir, createdAt: NOW, autoDispatch: true, coordinatorAccountId: 'acc_1', coordinatorSessionId: 'coord-dead' }],
    tasks: [task({ id: 'tsk_1', status: 'completed', result: 'done' }), task({ id: 'tsk_2' })],
    dispatches: [
      dispatch({ id: 'dsp_1', taskId: 'tsk_1', sessionId: 'sess-1', cwd: wt, endedAt: NOW, outcome: 'succeeded', workerState: 'stopped' }),
      dispatch({ id: 'dsp_2', taskId: 'tsk_2', sessionId: 'sess-2', cwd: wt, nativeSessionId: 'native-2' })
    ]
  })
  await fs.writeFile(file, JSON.stringify(s))
  return file
}

describe('resumeAfterCrash (Host killed -9 mid-plan, fakes for the spawns)', () => {
  it('keeps finished work, resumes the worker with its conversation in its worktree, and restarts the coordinator', async () => {
    const file = await crashedFile()
    // Uncommitted work the worker had in its worktree when the laptop died.
    await fs.writeFile(path.join(wt, 'wip.txt'), 'half done')

    const store = new OrchestrationStore(file)
    const started: { worktree: string; resume?: { nativeSessionId?: string; briefing?: string } }[] = []
    const runStarts: Record<string, unknown>[] = []
    const feed: ActivityDraft[] = []
    let recovered = false
    const deps = {
      getState: () => store.get(),
      setState: (n: Parameters<typeof store.save>[0]) => store.save(n),
      startWorker: async (a: (typeof started)[number]) => {
        started.push(a)
        return { sessionId: 'sess-new', cwd: a.worktree, specPath: 'spec.md' }
      },
      readGitSummary: (cwd: string) => readGitSummary(cwd),
      lang: () => 'en' as const,
      log: () => {}
    }

    const r = await resumeAfterCrash({
      readFile: () => readStateFile(file),
      // A fresh Host's registry holds no session: every open Dispatch is lost.
      ready: async () => void (await store.load({ aliveSessionIds: new Set() })),
      state: () => store.get(),
      // The Host's recovery, reduced to its decision and its execution over the real git facts.
      settle: async () => {
        if (recovered) return
        recovered = true
        const attempt = {
          runId: store.get().runs[0].id, taskId: 'tsk_2', dispatchId: 'dsp_2', provider: 'claude' as const, accountId: 'acc_1',
          cwd: wt, nativeSessionId: 'native-2', promptConfirmed: true, baseHead: sh(wt, 'rev-parse', 'HEAD'),
          hasValidateConfig: false, appDriven: true
        }
        const decision = decideRecovery({ attempt, git: await readGitFacts(wt), smartResume: true })
        await executeRecovery({ attempt, decision, state: store.get(), now: NOW }, deps as never)
      },
      handle: async (cmd, args) => {
        runStarts.push({ cmd, ...args })
        const s = store.get()
        await store.save({ ...s, runs: s.runs.map((x) => (x.id === args.run ? { ...x, coordinatorSessionId: 'coord-new' } : x)) })
        return { status: 200, body: {} }
      },
      activity: (d) => feed.push(d),
      log: () => {}
    })

    expect(r).toEqual({ workers: 1, coordinators: 1 })
    // Finished work kept.
    const s = store.get()
    expect(s.tasks.find((t) => t.id === 'tsk_1')?.status).toBe('completed')
    expect(s.dispatches.find((d) => d.id === 'dsp_1')).toMatchObject({ outcome: 'succeeded' })
    // The worker resumed in its worktree on its own conversation, not from scratch.
    expect(started).toHaveLength(1)
    expect(started[0].worktree).toBe(wt)
    expect(started[0].resume?.nativeSessionId).toBe('native-2')
    // Its uncommitted changes survive, and it is told about them.
    expect(await fs.readFile(path.join(wt, 'wip.txt'), 'utf8')).toBe('half done')
    expect(started[0].resume?.briefing).toContain(CRASH_RESUME_NOTE)
    expect(started[0].resume?.briefing).toContain('wip.txt')
    // A fresh coordinator, through run-start with the crash as its reason (its brief gets the hand-off).
    expect(runStarts).toEqual([{ cmd: 'run-start', run: s.runs[0].id, reason: CRASH_REASON }])
    expect(feed).toEqual([{ type: 'host.recovered', payload: { title: 'Astera', reason: 'Recovered after a crash: resumed 1 worker, 1 coordinator' } }])
  })

  it('does nothing, and loads nothing, when the file shows nothing in flight', async () => {
    let loaded = false
    const r = await resumeAfterCrash({
      readFile: () => stateFromLegacy({}),
      ready: async () => void (loaded = true),
      state: () => stateFromLegacy({}),
      settle: async () => {},
      handle: async () => ({ status: 200, body: {} }),
      activity: () => {},
      log: () => {}
    })
    expect(r).toBeNull()
    expect(loaded).toBe(false)
  })
})

describe('crashResumeBriefing', () => {
  it('lists the uncommitted files and says to keep them', () => {
    const b = crashResumeBriefing({ branch: 'b', head: 'h', changed: ['M src/a.ts'] } as never)
    expect(b).toContain(CRASH_RESUME_NOTE)
    expect(b).toContain('- M src/a.ts')
    expect(b).toContain('Do not reset')
  })
  it('says when git could not be read', () => {
    expect(crashResumeBriefing(null)).toContain('git status')
  })
})

it('crashFeedLine counts in words', () => {
  expect(crashFeedLine(3, 1)).toBe('Recovered after a crash: resumed 3 workers, 1 coordinator')
})
