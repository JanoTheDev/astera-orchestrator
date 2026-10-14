// The Host's job sources (plugin Phase 4 J6, J10, J17): the enabled plugins that name `job-source`, ready when they
// run, asked through the runtime with the time limit; and a Job made from an item once for one request id.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostJobSources, JOB_SOURCE_TIMEOUT_MS } from './jobSources'
import { createHostOrch } from './orch'
import { emptyState } from '../core/orchestration/state'
import { ensureProject } from '../core/orchestration/projects'
import type { JobSourcesDeps } from '../core/orchestration/commandSources'

const view = (id: string, o: Record<string, unknown> = {}) => ({ id, displayName: id.toUpperCase(), enabled: true, status: 'running', capabilities: ['job-source'], ...o })

describe('hostJobSources', () => {
  // The 4a review's I4: the list is read beside the manager's changes, not behind them; and Review Focus 3: a disabled
  // plugin is listed with why, so a call to it answers 503 rather than 404
  it('lists the job-source plugins, ready when they run, and why not otherwise, without waiting for a change', async () => {
    const manager = {
      list: async (): Promise<never> => {
        throw new Error('list waits behind the change in progress')
      },
      listNow: async () => ({
        status: 200,
        body: {
          plugins: [
            view('a'),
            view('b', { status: 'failed', reason: 'no key' }),
            view('c', { enabled: false, status: 'disabled' }),
            view('d', { capabilities: ['event'] }),
            view('e', { status: 'incompatible', reason: 'this Astera speaks Plugin API 1' })
          ]
        }
      })
    }
    const sources = hostJobSources({ manager, runtime: { request: async () => ({}) } })
    expect(await sources.plugins()).toEqual([
      { id: 'a', displayName: 'A', ready: true },
      { id: 'b', displayName: 'B', ready: false, reason: 'b is failed: no key' },
      { id: 'c', displayName: 'C', ready: false, reason: 'c is disabled' },
      { id: 'e', displayName: 'E', ready: false, reason: 'e is incompatible: this Astera speaks Plugin API 1' }
    ])
  })

  it('asks through the runtime with the 15 s limit', async () => {
    const asked: unknown[] = []
    const sources = hostJobSources({
      manager: { listNow: async () => ({ status: 200, body: { plugins: [] } }) },
      runtime: {
        request: async (...a: unknown[]) => {
          asked.push(a)
          return { items: [] }
        }
      }
    })
    await sources.ask('a', 'jobSource.list', { query: 'q' })
    expect(asked).toEqual([['a', 'jobSource.list', { query: 'q' }, JOB_SOURCE_TIMEOUT_MS]])
    expect(JOB_SOURCE_TIMEOUT_MS).toBe(15_000)
  })
})

describe('a Job made from an item through the Host', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-jobsources-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  // Review Focus 5 (J17): the receipt the request id keeps answers the second send
  it('is made once for one request id', async () => {
    const logged: string[] = []
    const reg = ensureProject(emptyState(), { path: path.join(dir, 'proj'), now: 'T' })
    await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(reg.state), 'utf8')
    const jobSources: JobSourcesDeps = {
      plugins: async () => [{ id: 'astera-linear-source', displayName: 'Linear', ready: true }],
      ask: async () => ({ objective: 'Fix login', sourceLabel: 'Linear ENG-1' })
    }
    const orch = createHostOrch({
      profileDir: dir,
      version: '9.9.9',
      now: () => '2026-10-14T00:00:00.000Z',
      hostStartedAt: () => 'T',
      runningSessions: () => 0,
      aliveSessionIds: () => new Set<string>(),
      // The app's acts: a project root is the folder given, as the app answers for a registered project
      act: async (name: string, args: unknown[]) => (name === 'resolveProjectRoot' ? args[0] : {}),
      hasApp: () => true,
      onState: () => {},
      log: (m) => logged.push(m),
      sessions: {
        listSessions: async () => [],
        readSession: async () => ({ cols: 80, rows: 24, screen: [], scrollback: [] }),
        sendSession: async () => {},
        readChat: async () => [],
        sendChat: async () => {},
        serial: (_id, run) => run()
      },
      jobSources
    })
    await orch.ready()
    const cli = { role: 'cli' as const, toOthers: () => {} }
    const args = { source: 'astera-linear-source', item: 'ENG-1', project: reg.project.id }
    const first = await orch.call({ cmd: 'jobs-create-from-source', args, sessionId: '', from: cli, request: 'req-src-1' })
    expect(first.status, logged.join(' || ')).toBe(200)
    const second = await orch.call({ cmd: 'jobs-create-from-source', args, sessionId: '', from: cli, request: 'req-src-1' })
    expect(second).toEqual({ ...first, replayed: true })
    const jobs = await orch.call({ cmd: 'jobs-list', args: {}, sessionId: '', from: cli })
    expect(jobs.body).toHaveLength(1)
  })
})
