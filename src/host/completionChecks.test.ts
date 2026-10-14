// The Host's completion check plugins (plugin Phase 5 C1, C2, C5, C7): which there are, and a check asked of one through
// the runtime's request with CHECK_TIMEOUT_MS, its answer checked and cut, every failure an `error` answer saying why.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostCompletionChecks } from './completionChecks'
import { createPluginManager } from './plugins/manager'
import { removeFixture } from '../core/testFixtures'
import { PluginRequestFailed } from './plugins/runtime'
import { CHECK_TIMEOUT_MS } from '../core/orchestration/types'
import type { CompletionCheckInput } from '../core/orchestration/pluginChecks'

const view = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  displayName: `${id} display`,
  enabled: true,
  status: 'running',
  capabilities: ['completion-check'],
  ...over
})
const VIEWS = [view('ok'), view('notifier', { capabilities: ['notification'] }), view('off', { enabled: false, status: 'disabled' })]
const INPUT: CompletionCheckInput = { jobId: 'job1', runId: 'run1', taskId: 't1', task: { title: 'T' }, workspace: { root: '/w' } }

const make = (answer: () => Promise<unknown>, list: () => Promise<{ status: number; body: unknown }> = async () => ({ status: 200, body: { plugins: VIEWS } })) => {
  const asked: unknown[][] = []
  const checks = hostCompletionChecks({
    manager: { listNow: list } as never,
    runtime: {
      request: async (...a: unknown[]) => {
        asked.push(a)
        return answer()
      }
    } as never
  })
  return { checks, asked }
}

// 5a final review M9: the views it reads are the plugin manager's own, as a person's install leaves them
describe('the Host’s completion check plugins over the real plugin manager', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) await removeFixture(d)
  })
  /** A plugin folder: its manifest names `capabilities`. */
  const folder = async (root: string, name: string, displayName: string, capabilities: string[]): Promise<string> => {
    const at = path.join(root, name.replace(/[@/]/g, '_'))
    await fs.mkdir(path.join(at, 'dist'), { recursive: true })
    const pkg = { name, version: '1.0.0', displayName, astera: { apiVersion: '1', entry: './dist/plugin.js', permissions: [], capabilities } }
    await fs.writeFile(path.join(at, 'package.json'), JSON.stringify(pkg))
    await fs.writeFile(path.join(at, 'dist', 'plugin.js'), 'export default {}')
    return at
  }

  it('reads whether each installed plugin checks and is enabled, by its display name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-checks-'))
    dirs.push(root)
    const manager = createPluginManager({ profileDir: path.join(root, 'profile'), hostVersion: '9.9.9' })
    expect((await manager.install({ path: await folder(root, '@acme/astera-leftovers', 'Debug leftovers', ['completion-check']), grant: [] })).status).toBe(200)
    expect((await manager.install({ path: await folder(root, '@acme/astera-quiet', 'Quiet', []), grant: [] })).status).toBe(200)
    await manager.setEnabled('@acme/astera-quiet', false)
    const asked: unknown[] = []
    const checks = hostCompletionChecks({ manager, runtime: { request: async (...a: unknown[]) => (asked.push(a), { status: 'passed' }) }, startWaitMs: 0 })
    expect(await checks.plugins()).toEqual([
      { id: '@acme/astera-leftovers', displayName: 'Debug leftovers', check: true, enabled: true },
      { id: '@acme/astera-quiet', displayName: 'Quiet', check: false, enabled: false }
    ])
    expect(await checks.run('@acme/astera-leftovers', INPUT)).toEqual({ name: 'Debug leftovers', status: 'passed', summary: 'passed' })
    expect(await checks.run('@acme/astera-quiet', INPUT)).toEqual({ name: 'Quiet', status: 'error', summary: '@acme/astera-quiet does not offer completion checks' })
    expect(asked).toHaveLength(1)
  })
})

describe('the Host’s completion check plugins', () => {
  it('lists every installed plugin with whether it checks and whether it is enabled', async () => {
    const { checks } = make(async () => null)
    expect(await checks.plugins()).toEqual([
      { id: 'ok', displayName: 'ok display', check: true, enabled: true },
      { id: 'notifier', displayName: 'notifier display', check: false, enabled: true },
      { id: 'off', displayName: 'off display', check: true, enabled: false }
    ])
  })

  it('answers null when the list cannot be read', async () => {
    const { checks } = make(async () => null, async () => ({ status: 500, body: { error: 'broken registry' } }))
    expect(await checks.plugins()).toBeNull()
  })

  it('asks the plugin with completionCheck.run and the check’s time limit, and checks and cuts its answer', async () => {
    const { checks, asked } = make(async () => ({ status: 'failed', summary: 'x'.repeat(3000), diagnostics: [{ message: 'm', line: 0 }] }))
    const r = await checks.run('ok', INPUT)
    expect(asked).toEqual([['ok', 'completionCheck.run', { input: INPUT }, CHECK_TIMEOUT_MS]])
    expect(r.name).toBe('ok display')
    expect(r.status).toBe('failed')
    expect(r.summary.length).toBeLessThanOrEqual(1000)
    expect(r.diagnostics).toEqual([{ message: 'm' }])
  })

  it('answers error for a plugin that is not installed, does not check, or is disabled, without asking it', async () => {
    const { checks, asked } = make(async () => ({ status: 'passed' }))
    expect(await checks.run('gone', INPUT)).toEqual({ name: 'gone', status: 'error', summary: 'no plugin gone is installed' })
    expect(await checks.run('notifier', INPUT)).toEqual({ name: 'notifier display', status: 'error', summary: 'notifier does not offer completion checks' })
    expect(await checks.run('off', INPUT)).toEqual({ name: 'off display', status: 'error', summary: 'off is disabled' })
    expect(asked).toEqual([])
  })

  it('answers error with the runtime’s reason when the plugin does not run, threw, or did not answer in time', async () => {
    const stopped = make(async () => Promise.reject(new PluginRequestFailed(503, 'ok is stopped')))
    expect(await stopped.checks.run('ok', INPUT)).toEqual({ name: 'ok display', status: 'error', summary: 'ok is stopped' })
    const threw = make(async () => Promise.reject(new PluginRequestFailed(502, 'runCheck threw: git is not installed')))
    expect(await threw.checks.run('ok', INPUT)).toEqual({ name: 'ok display', status: 'error', summary: 'runCheck threw: git is not installed' })
    const late = make(async () => Promise.reject(new PluginRequestFailed(504, `ok did not answer within ${CHECK_TIMEOUT_MS / 1000} s`)))
    expect(await late.checks.run('ok', INPUT)).toEqual({ name: 'ok display', status: 'error', summary: 'ok did not answer within 30 minutes' })
    const odd = make(async () => Promise.reject(new Error('socket hang up')))
    expect(await odd.checks.run('ok', INPUT)).toEqual({ name: 'ok display', status: 'error', summary: 'socket hang up' })
  })

  it('answers error for an answer of the wrong shape', async () => {
    const { checks } = make(async () => ({ status: 'great' }))
    expect(await checks.run('ok', INPUT)).toMatchObject({ status: 'error', summary: expect.stringMatching(/^the plugin answered with something that is not a check result: /) })
  })

  // 5a final review M1: a Host that just started is still starting its plugins; their checks wait for them, a while
  it('waits for a plugin that is coming up, then asks it', async () => {
    const states = ['stopped', 'starting', 'running']
    let n = 0
    const asked: unknown[] = []
    const checks = hostCompletionChecks({
      manager: { listNow: async () => ({ status: 200, body: { plugins: [view('ok', { status: states[Math.min(n++, 2)] })] } }) } as never,
      runtime: { request: async (...a: unknown[]) => (asked.push(a), { status: 'passed' }) } as never,
      startWaitMs: 5_000,
      pollMs: 1
    })
    expect(await checks.run('ok', INPUT)).toEqual({ name: 'ok display', status: 'passed', summary: 'passed' })
    expect(n).toBe(3)
    expect(asked).toHaveLength(1)
  })

  it('asks a plugin that stays starting once the wait is over, and does not wait for one held back or failed', async () => {
    const asked: string[] = []
    const make2 = (status: string, reason?: string) =>
      hostCompletionChecks({
        manager: { listNow: async () => ({ status: 200, body: { plugins: [view('ok', { status, ...(reason ? { reason } : {}) })] } }) } as never,
        runtime: { request: async () => (asked.push(status), Promise.reject(new PluginRequestFailed(503, `ok is ${status}`))) } as never,
        startWaitMs: 20,
        pollMs: 1
      })
    const t0 = Date.now()
    expect(await make2('starting').run('ok', INPUT)).toMatchObject({ status: 'error', summary: 'ok is starting' })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
    const t1 = Date.now()
    expect(await make2('stopped', 'waiting for its settings').run('ok', INPUT)).toMatchObject({ status: 'error' })
    expect(await make2('failed').run('ok', INPUT)).toMatchObject({ status: 'error' })
    expect(Date.now() - t1).toBeLessThan(15)
    expect(asked).toEqual(['starting', 'stopped', 'failed'])
  })

  // 5a final review M7: an app that leaves mid-check, and the Host's sweep asking again for the same Task, ask once
  it('joins a check of the same Task already being asked, and asks again once it has answered', async () => {
    const pending: Array<(v: unknown) => void> = []
    const { checks, asked } = make(() => new Promise((r) => pending.push(r)))
    const first = checks.run('ok', INPUT)
    const second = checks.run('ok', INPUT)
    const otherTask = checks.run('ok', { ...INPUT, taskId: 't2' })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(asked.map((a) => (a[2] as { input: CompletionCheckInput }).input.taskId)).toEqual(['t1', 't2'])
    pending[0]({ status: 'passed', summary: 'joined' })
    expect(await first).toEqual({ name: 'ok display', status: 'passed', summary: 'joined' })
    expect(await second).toEqual({ name: 'ok display', status: 'passed', summary: 'joined' })
    pending[1]({ status: 'passed' })
    await otherTask
    // Answered: the next ask (a retry, a new round) is a new question
    const again = checks.run('ok', INPUT)
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2]({ status: 'passed' })
    await again
  })

  it('asks a plugin it could not look up, rather than refuse a check the list could not judge', async () => {
    const { checks, asked } = make(async () => ({ status: 'passed' }), async () => ({ status: 500, body: { error: 'broken' } }))
    expect(await checks.run('ok', INPUT)).toEqual({ name: 'ok', status: 'passed', summary: 'passed' })
    expect(asked).toHaveLength(1)
  })
})
