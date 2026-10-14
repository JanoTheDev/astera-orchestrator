// Refusing a plugin check early (plugin Phase 5 C7, C14): `tasks add`, `jobs run` and `run-start` refuse a check list
// naming `plugin:<id>` whose plugin is not installed, does not offer completion checks, or is disabled, with 409 and
// PLUGIN_CAPABILITY_MISSING. A Runtime's Host refuses with its own plugins, so a paired Runtime without the plugin
// refuses the same way. Where no plugin list is wired, or it cannot be read, nothing is refused: the check then says so.
import { describe, it, expect } from 'vitest'
import { handleCommand, type CompletionCheckPlugin, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'

const NOW = '2026-10-14T00:00:00.000Z'

const PLUGINS: CompletionCheckPlugin[] = [
  { id: 'ok', displayName: 'OK', check: true, enabled: true },
  { id: 'notifier', displayName: 'Notifier', check: false, enabled: true },
  { id: 'off', displayName: 'Off', check: true, enabled: false }
]

const makeDeps = (plugins: (() => Promise<CompletionCheckPlugin[] | null>) | null = async () => PLUGINS): OrchServerDeps & { spawned: string[] } => {
  const box = { state: emptyState() as OrchState }
  const spawned: string[] = []
  return {
    spawned,
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 'sess1', cwd: 'D:/w', specPath: 'D:/specs/a.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'A', provider: 'claude' }],
    readWorker: async () => 'output',
    now: () => NOW,
    listRunConfigs: async () => [{ id: 'npm-test', name: 'Tests', type: 'npm' }],
    makeRunWorktree: async (a: { name: string }) => `D:/wt/${a.name}`,
    startCoordinator: async (a: { runId: string }) => {
      spawned.push(a.runId)
      return { sessionId: `coord-${spawned.length}` }
    },
    ...(plugins ? { completionChecks: { plugins, run: async () => ({ name: 'x', status: 'passed' as const, summary: 'passed' }) } } : {})
  } as unknown as OrchServerDeps & { spawned: string[] }
}

const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown> = {}) => handleCommand(deps, { sessionId: 'coordinator' }, cmd, args)

/** A Job not yet run (`jobs run` makes its first Run), with one definition Task checked by `validate`. */
async function job(deps: OrchServerDeps, validate: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true, ...extra })
  const jobId = (r.body as { id: string }).id
  const t = await call(deps, 'task-create', { run: jobId, spec: 's', account: 'acc1', validate })
  expect(t.status).toBe(200)
  return jobId
}

describe('tasks add refuses a plugin check whose plugin is missing', () => {
  it('names which of the three it is, with the code', async () => {
    const deps = makeDeps()
    const jobId = (await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true })).body as { id: string }
    const add = (validate: string) => call(deps, 'tasks-add', { job: jobId.id, spec: 's', account: 'acc1', validate })
    expect(await add('npm-test,plugin:gone')).toEqual({
      status: 409,
      body: { error: 'plugin:gone: no plugin gone is installed', code: 'PLUGIN_CAPABILITY_MISSING' }
    })
    expect((await add('plugin:notifier')).body).toMatchObject({ error: 'plugin:notifier: notifier does not offer completion checks', code: 'PLUGIN_CAPABILITY_MISSING' })
    expect((await add('plugin:off')).body).toMatchObject({ error: 'plugin:off: off is disabled', code: 'PLUGIN_CAPABILITY_MISSING' })
    expect((await add('plugin:gone,plugin:off')).body).toMatchObject({ error: 'plugin:gone: no plugin gone is installed; plugin:off: off is disabled' })
    expect(deps.getState().tasks).toEqual([])
  })

  it('adds a Task whose plugin checks are there, beside run configurations it still checks', async () => {
    const deps = makeDeps()
    const jobId = ((await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true })).body as { id: string }).id
    const r = await call(deps, 'tasks-add', { job: jobId, spec: 's', account: 'acc1', validate: 'npm-test,plugin:ok' })
    expect(r.status).toBe(200)
    expect(deps.getState().tasks[0].validateConfigIds).toEqual(['npm-test', 'plugin:ok'])
    const unknownConfig = await call(deps, 'tasks-add', { job: jobId, spec: 's', account: 'acc1', validate: 'plugin:ok,lint' })
    expect(unknownConfig.status).toBe(404)
    expect((unknownConfig.body as { error: string }).error).toContain('unknown run configuration: lint')
  })

  it('needs no run configuration list for plugin checks alone', async () => {
    const deps = makeDeps()
    delete (deps as { listRunConfigs?: unknown }).listRunConfigs
    const jobId = ((await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true })).body as { id: string }).id
    expect((await call(deps, 'tasks-add', { job: jobId, spec: 's', account: 'acc1', validate: 'plugin:ok' })).status).toBe(200)
  })

  it('refuses nothing where no plugin list is wired, or it cannot be read', async () => {
    for (const deps of [makeDeps(null), makeDeps(async () => null)]) {
      const jobId = ((await call(deps, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true })).body as { id: string }).id
      expect((await call(deps, 'tasks-add', { job: jobId, spec: 's', account: 'acc1', validate: 'plugin:gone' })).status).toBe(200)
    }
  })

  it('is refused the same way by a Runtime’s Host that lacks the plugin (C14)', async () => {
    const runtimeHost = makeDeps(async () => [])
    const jobId = ((await call(runtimeHost, 'run-create', { objective: 'o', cwd: 'D:/p', auto: true })).body as { id: string }).id
    expect((await call(runtimeHost, 'tasks-add', { job: jobId, spec: 's', account: 'acc1', validate: 'plugin:ok' })).body).toMatchObject({
      code: 'PLUGIN_CAPABILITY_MISSING'
    })
  })
})

// 5a final review I2: the plugin list is read before the state, so nothing a command commits is built on a state read
// before an await
describe('the early refusal reads the plugins before the state', () => {
  it('run-start of a Job keeps a commit that landed while the plugins were read', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:ok')
    const other = ((await call(deps, 'run-create', { objective: 'other', cwd: 'D:/q', auto: true })).body as { id: string }).id
    ;(deps.completionChecks as { plugins: () => Promise<CompletionCheckPlugin[]> }).plugins = async () => {
      // Another client commits while the list is read
      await call(deps, 'task-create', { run: other, spec: 'landed meanwhile', account: 'acc1' })
      return PLUGINS
    }
    expect((await call(deps, 'run-start', { run: jobId })).status).toBe(200)
    expect(deps.getState().tasks.filter((t) => t.jobId === other)).toHaveLength(1)
    expect(deps.getState().runs.filter((r) => r.jobId === jobId)).toHaveLength(1)
  })

  it('jobs run reads the list once, and two at once make one Run', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:ok')
    let reads = 0
    ;(deps.completionChecks as { plugins: () => Promise<CompletionCheckPlugin[]> }).plugins = async () => {
      reads++
      await new Promise((r) => setTimeout(r, 5))
      return PLUGINS
    }
    const [a, b] = await Promise.all([call(deps, 'jobs-run', { id: jobId }), call(deps, 'jobs-run', { id: jobId })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(deps.getState().runs.filter((r) => r.jobId === jobId)).toHaveLength(1)
    expect(reads).toBe(2)
  })
})

describe('jobs run and run-start refuse a Run whose Tasks name a missing plugin', () => {
  it('jobs run makes no Run', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:gone')
    const r = await call(deps, 'jobs-run', { id: jobId })
    expect(r).toEqual({ status: 409, body: { error: 'plugin:gone: no plugin gone is installed', code: 'PLUGIN_CAPABILITY_MISSING' } })
    expect(deps.getState().runs).toEqual([])
  })

  it('jobs run starts a Job whose plugins are there', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'npm-test,plugin:ok')
    expect((await call(deps, 'jobs-run', { id: jobId })).status).toBe(200)
    expect(deps.getState().runs).toHaveLength(1)
  })

  it('jobs run of a Job run before checks the Tasks its next Run copies', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:ok')
    expect((await call(deps, 'jobs-run', { id: jobId })).status).toBe(200)
    for (const t of deps.getState().tasks) await call(deps, 'task-update', { id: t.id, status: 'completed' })
    // The plugin goes away before the next Run
    ;(deps.completionChecks as { plugins: () => Promise<CompletionCheckPlugin[]> }).plugins = async () => []
    expect((await call(deps, 'jobs-run', { id: jobId })).status).toBe(409)
    expect(deps.getState().runs).toHaveLength(1)
  })

  it('run-start of a Job makes no Run', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:off')
    expect((await call(deps, 'run-start', { run: jobId })).body).toMatchObject({ code: 'PLUGIN_CAPABILITY_MISSING' })
    expect(deps.getState().runs).toEqual([])
  })

  it('run-start of a Run starts no coordinator for it', async () => {
    const deps = makeDeps()
    const jobId = await job(deps, 'plugin:ok', { coordinatorAccount: 'acc1' })
    expect((await call(deps, 'run-start', { run: jobId })).status).toBe(200)
    const run = deps.getState().runs[0]
    expect(deps.spawned).toEqual([run.id])
    // Its coordinator went away, and so did the plugin
    const s = deps.getState()
    await deps.setState({ ...s, runs: s.runs.map((r) => ({ ...r, coordinatorSessionId: undefined })) })
    ;(deps.completionChecks as { plugins: () => Promise<CompletionCheckPlugin[]> }).plugins = async () => []
    expect((await call(deps, 'run-start', { run: run.id })).body).toMatchObject({ code: 'PLUGIN_CAPABILITY_MISSING' })
    expect(deps.spawned).toEqual([run.id])
  })
})
