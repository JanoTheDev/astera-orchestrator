// The app's way to the Host's completion check plugins (plugin Phase 5 C7, C8): the plugin list through `plugins-list`,
// a check through `checks-plugin-run`, both over the app's orch-call. Whatever goes wrong on the way is an `error`
// answer, which the checks read as a check that could not be made: never a failed check that spends a repair.
import { describe, it, expect, vi } from 'vitest'
import { createAppCompletionChecks, PLUGIN_CHECK_DEADLINE_MS } from './pluginChecksRoute'
import { NO_HOST_CONNECTION, hostDeadlineMessage } from './worktreeRoute'
import { CHECK_TIMEOUT_MS } from '../../core/orchestration/types'
import { TIMEOUT_HEADROOM_MS } from '../../core/publicContract'
import type { CompletionCheckInput } from '../../core/orchestration/pluginChecks'
import { createTaskValidation } from '../../core/orchestration/exec/validation'
import { applyWorkerDone, createJob, createTask, emptyState, openDispatch, startJobRun, type OrchState } from '../../core/orchestration/state'

const INPUT: CompletionCheckInput = { jobId: 'job1', runId: 'run1', taskId: 't1', task: { title: 'T' }, workspace: { root: '/w' } }
type Call = Parameters<typeof createAppCompletionChecks>[0]['call']

describe('the app’s completion check plugins', () => {
  it('asks the Host with checks-plugin-run and the check’s deadline, and checks its answer again', async () => {
    const sent: unknown[] = []
    const call: Call = async (m) => {
      sent.push(m)
      return { status: 200, body: { name: 'D', status: 'failed', summary: 'x'.repeat(3000), diagnostics: [{ message: 'm', line: -1 }] } }
    }
    const r = await createAppCompletionChecks({ call }).run('d', INPUT)
    expect(sent).toEqual([{ cmd: 'checks-plugin-run', args: { plugin: 'd', input: INPUT }, sessionId: '', timeoutMs: PLUGIN_CHECK_DEADLINE_MS }])
    expect(PLUGIN_CHECK_DEADLINE_MS).toBe(CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
    expect(r.name).toBe('D')
    expect(r.status).toBe('failed')
    expect(r.summary.length).toBeLessThanOrEqual(1000)
    expect(r.diagnostics).toEqual([{ message: 'm' }])
  })

  // 5d final review M2: the Host has already cut the answer to 20 findings; checking it again here keeps its count
  it('keeps the count of findings the Host cut, when it checks the answer again', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ message: `m${i}` }))
    const call: Call = async () => ({ status: 200, body: { name: 'D', status: 'failed', summary: 's', diagnostics: twenty, diagnosticsTotal: 150 } })
    const r = await createAppCompletionChecks({ call }).run('d', INPUT)
    expect(r.diagnostics).toHaveLength(20)
    expect(r.diagnosticsTotal).toBe(150)
  })

  it('names a check by its plugin id when the Host’s answer has no name', async () => {
    const r = await createAppCompletionChecks({ call: async () => ({ status: 200, body: { status: 'passed' } }) }).run('d', INPUT)
    expect(r).toEqual({ name: 'd', status: 'passed', summary: 'passed' })
  })

  it('answers error when the Host cannot be asked, does not answer in time, or the connection goes', async () => {
    for (const message of [NO_HOST_CONNECTION, hostDeadlineMessage('checks-plugin-run', PLUGIN_CHECK_DEADLINE_MS), 'the Host connection closed']) {
      const r = await createAppCompletionChecks({ call: async () => Promise.reject(new Error(message)) }).run('d', INPUT)
      expect(r).toEqual({ name: 'd', status: 'error', summary: `the Host could not be asked: ${message}` })
    }
  })

  it('answers error with the Host’s sentence when it refuses', async () => {
    const r = await createAppCompletionChecks({ call: async () => ({ status: 501, body: { error: 'this Host runs no completion check plugins' } }) }).run('d', INPUT)
    expect(r).toEqual({ name: 'd', status: 'error', summary: 'this Host runs no completion check plugins' })
    const bare = await createAppCompletionChecks({ call: async () => ({ status: 403, body: null }) }).run('d', INPUT)
    expect(bare).toEqual({ name: 'd', status: 'error', summary: 'the Host answered 403' })
  })

  it('lists the Host’s plugins through plugins-list, and null when it cannot', async () => {
    const views = [
      { id: 'ok', displayName: 'OK', enabled: true, capabilities: ['completion-check'] },
      { id: 'n', enabled: false, capabilities: ['notification'] }
    ]
    const sent: unknown[] = []
    const ok = createAppCompletionChecks({ call: async (m) => (sent.push(m), { status: 200, body: { plugins: views } }) })
    expect(await ok.plugins()).toEqual([
      { id: 'ok', displayName: 'OK', check: true, enabled: true },
      { id: 'n', displayName: 'n', check: false, enabled: false }
    ])
    expect(sent).toEqual([{ cmd: 'plugins-list', args: {}, sessionId: '' }])
    expect(await createAppCompletionChecks({ call: async () => ({ status: 500, body: {} }) }).plugins()).toBeNull()
    expect(await createAppCompletionChecks({ call: async () => Promise.reject(new Error(NO_HOST_CONNECTION)) }).plugins()).toBeNull()
  })
})

// Review Focus 4: the app drives a Task's checks and the Host connection goes mid-request, twice
describe('a plugin check the app drives while the Host is gone', () => {
  it('ends on the question, spending no repair', async () => {
    const NOW = '2026-10-14T00:00:00.000Z'
    const unwrap = <T>(r: { ok: boolean } & Record<string, unknown>): { state: OrchState; value: T } => {
      if (!r.ok) throw new Error(String(r.error))
      return { state: r.state as OrchState, value: r.value as T }
    }
    const planned = unwrap<{ id: string }>(createJob(emptyState(), { objective: 'o', cwd: 'D:/p', convergence: {} }, NOW) as never)
    const run = unwrap<{ id: string }>(startJobRun(planned.state, planned.value.id, NOW) as never)
    const t = unwrap<{ id: string }>(createTask(run.state, { runId: run.value.id, title: 'T', spec: 's', deps: [], validateConfigIds: ['plugin:d'] }, NOW) as never)
    const d = unwrap<{ id: string }>(
      openDispatch(t.state, { taskId: t.value.id, provider: 'claude', accountId: 'accA', sessionId: 'sess1', cwd: 'D:/p', specPath: 'D:/s.md' }, NOW) as never
    )
    let state = unwrap(applyWorkerDone(d.state, { taskId: t.value.id, dispatchId: d.value.id, outcome: 'succeeded', subject: 's', body: 'b' }, NOW) as never).state
    const calls: unknown[] = []
    const route = createAppCompletionChecks({
      call: async (m) => {
        calls.push(m)
        throw new Error('the Host connection closed')
      }
    })
    const startRepair = vi.fn(async () => undefined)
    const validation = createTaskValidation({
      getState: () => state,
      setState: async (n) => {
        state = n
      },
      now: () => NOW,
      lang: () => 'en',
      log: () => {},
      assertAllowedPath: async (p) => p,
      storedConfigs: () => [],
      runs: { start: () => ({ runId: 'r1' }), recentOutput: () => '', stop: () => {} },
      isAlive: () => true,
      startReview: async () => {},
      startRepair,
      firstCheckpointHead: () => null,
      diffNames: async () => null,
      pluginCheck: (plugin, input) => route.run(plugin, input)
    })
    validation.startValidation({ taskId: t.value.id, cwd: 'D:/p' })
    await vi.waitFor(() => expect(state.tasks[0].status).toBe('blocked'))
    expect(calls).toHaveLength(2)
    expect(state.tasks[0].consecutiveFailures).toBe(0)
    expect(state.dispatches.filter((x) => x.repair !== undefined)).toEqual([])
    expect(startRepair).not.toHaveBeenCalled()
    expect(state.gates.find((g) => g.status === 'open')).toMatchObject({
      kind: 'check-unavailable',
      question: 'The check could not be made: d: the Host could not be asked: the Host connection closed'
    })
  })
})
