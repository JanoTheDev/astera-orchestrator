// The sample plugins as a person uses them (plugins 2f, plugin Phase 3): each manifest is one Astera installs, each
// plugin imports only Node's own modules so its folder installs as it is, it typechecks against the SDK's types, and it
// runs in the real plugin runtime (the launcher bundled, a process of its own) from a copy made as a folder install
// makes it, handed the events of a real event log as the Host hands them.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { removeFixture } from '../../src/core/testFixtures'
import { parseManifest } from '../../src/core/plugins/manifest'
import { createPluginRuntime, type PluginRuntime } from '../../src/host/plugins/runtime'
import { copyPluginFolder } from '../../src/host/plugins/copyFolder'
import { createEventRing, type EventRing } from '../../src/core/events/eventRing'
import type { EventDraft } from '../../src/core/orchestration/publicEvents'
import type { AsteraEvent } from '../../src/core/publicContract'
import { bundleLauncher } from '../../src/pluginHost/testkit'
import { runTsc } from '../../packages/client/test/typecheck'

const here = path.dirname(fileURLToPath(import.meta.url))
const NOTIFIER = path.join(here, 'webhook-notifier')
const ID = 'astera-webhook-notifier'

let work: string
let launcher: string
/** The sample as `astera plugins install --path` copies it (2f final review m10): it runs from there, not the repo. */
let installed: string
beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), 'astera-plugin samples '))
  launcher = await bundleLauncher(work)
  installed = path.join(work, 'installed', ID)
  await copyPluginFolder(NOTIFIER, installed)
}, 60_000)
afterAll(async () => {
  await removeFixture(work)
})
const started: PluginRuntime[] = []
const servers: http.Server[] = []
afterEach(async () => {
  for (const r of started.splice(0)) await r.stopAll()
  for (const s of servers.splice(0)) await new Promise((res) => s.close(() => res(undefined)))
})

// 45 s: starts and restarts of a real plugin process under the full suite, as the runtime rig's (load-sensitive tests,
// 2026-10-14, final review I2)
const until = <T>(f: () => T, timeout = 45_000): Promise<T> => vi.waitFor(f, { timeout, interval: 25 })

/** A webhook that answers with `statuses` in turn (200 once they run out), and keeps what it was sent. */
async function webhook(statuses: number[] = []) {
  const bodies: unknown[] = []
  const posts: { text: string; signature: string | undefined }[] = []
  const server = http.createServer((req, res) => {
    let text = ''
    req.setEncoding('utf8').on('data', (c: string) => (text += c))
    req.on('end', () => {
      const status = statuses.shift() ?? 200
      if (status === 200) {
        bodies.push(JSON.parse(text))
        const signature = req.headers['x-astera-signature']
        posts.push({ text, signature: typeof signature === 'string' ? signature : undefined })
      }
      res.writeHead(status)
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/T0/B0/secret-part`, bodies, posts }
}

const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'completed', progress: { done: 2, total: 2 }, questionsOpen: 0 }

/** Appends one event to the log, as a commit would, and answers it as the log holds it. */
const append = (ring: EventRing, draft: EventDraft): AsteraEvent => ring.append([draft], 'T')[0].event
const completed = (ring: EventRing): AsteraEvent => append(ring, { type: 'run.completed', jobId: 'job_1', runId: 'run_1', payload: RUN })
const failed = (ring: EventRing): AsteraEvent => append(ring, { type: 'run.failed', jobId: 'job_1', runId: 'run_1', payload: { ...RUN, outcome: 'failed' } })

/** The plugin runtime with a Host that answers no command (the sample asks for none) and an event log of its own,
 *  holding at most `retain` events. */
function runtime(o: { failAfter?: number; retain?: number } = {}) {
  const ring = createEventRing({ boot: 'aaaaaaaaaaaa', retainEvents: o.retain ?? 2000, retainChars: 1 << 23 })
  const r = createPluginRuntime({
    profileDir: path.join(work, `profile ${started.length + Math.random()}`),
    exec: process.execPath,
    launcher,
    env: process.env,
    host: () => ({ version: '9.9.9', pid: process.pid, startedAt: 'T', features: ['orch', 'requests', 'events'] }),
    orch: { call: (async (a: { cmd: string }) => ({ status: 404, body: { error: `no ${a.cmd} here` } })) as never },
    log: () => {},
    // The runtime rig's budgets (src/host/plugins/runtime.test.ts): a start is a process spawn, and a crash counts as
    // quick within the start's own time under load
    timings: { startMs: 60_000, stopGraceMs: 2_000, backoffMs: [50, 50], stableMs: 30_000, failAfter: o.failAfter ?? 3 },
    events: ring,
    // Astera's own retries, quick: a failed post is handed over again
    delivery: { retryFirstMs: 50, retryMaxMs: 50 }
  })
  started.push(r)
  return { r, ring }
}

const launch = (settings: Record<string, string | number | boolean>, redact: string[]) => ({
  id: ID,
  version: '0.2.0',
  folder: ID,
  dir: installed,
  entry: path.join(installed, 'index.mjs'),
  granted: ['events.subscribe'],
  capabilities: ['event' as const],
  settings,
  redact
})
const logOf = (r: PluginRuntime): string => (existsSync(r.logFile(ID)) ? readFileSync(r.logFile(ID), 'utf8') : '')

/** Starts the sample and waits until it runs, so the events appended after it are its to post. */
async function running(r: PluginRuntime, settings: Record<string, string | number | boolean>, redact: string[]): Promise<void> {
  r.start(launch(settings, redact))
  await until(() => expect(r.status(ID)?.status).toBe('running'))
}

describe('the webhook notifier sample', () => {
  it('is a manifest Astera installs: an event plugin with the one permission that needs, a secret webhook URL, and a choice', () => {
    const read = parseManifest(JSON.parse(readFileSync(path.join(NOTIFIER, 'package.json'), 'utf8')))
    if (!read.ok) throw new Error(read.problems.join('; '))
    expect(read.manifest).toMatchObject({ id: ID, apiVersion: '1', entry: 'index.mjs', permissions: ['events.subscribe'], capabilities: ['event'] })
    expect(read.manifest.minAsteraVersion).toBeUndefined()
    expect(read.manifest.settings).toEqual([
      expect.objectContaining({ key: 'webhookUrl', type: 'string', secret: true, required: true }),
      expect.objectContaining({ key: 'signingSecret', type: 'string', secret: true, required: false }),
      expect.objectContaining({ key: 'onlyProblems', type: 'boolean', default: false, required: false })
    ])
  })

  it('imports only Node’s own modules, so its folder installs as it is', () => {
    const code = readFileSync(path.join(NOTIFIER, 'index.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // `from 'x'`, `import 'x'` and `import('x')`, in any quotes (2f final review m10)
    const specifiers = [...code.matchAll(/\b(?:from|import)\s*\(?\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2])
    expect(specifiers).toContain('node:crypto')
    expect(specifiers.filter((s) => !s.startsWith('node:'))).toEqual([])
  })

  it('typechecks against the plugin SDK’s types', () => {
    expect(runTsc(path.join(here, 'tsconfig.json'))).toBe('')
  }, 60_000)

  it('posts a completed Run to the webhook, is handed it again by Astera when a post fails, and keeps the URL out of its log', async () => {
    const hook = await webhook([500])
    const { r, ring } = runtime()
    await running(r, { webhookUrl: hook.url, onlyProblems: false }, [hook.url])
    const e = completed(ring)
    await until(() => expect(hook.bodies).toHaveLength(1))
    expect(hook.bodies[0]).toEqual({ text: 'Run run_1 of job job_1 completed (2 of 2 tasks)', event: e })
    await until(() => expect(logOf(r)).toContain(`posted run.completed ${e.id}`))
    expect(logOf(r)).toContain(`delivering run.completed ${e.id} failed (try 1): onEvent threw: the webhook answered 500`)
    expect(logOf(r)).not.toContain('secret-part')
    // No signing secret, no signature
    expect(hook.posts[0].signature).toBeUndefined()
  }, 90_000)

  // Spec §17: a webhook plugin's settings are its URL, a secret, event filters and a retry policy
  it('signs each post with the signing secret when one is set, so a service of your own can tell it came from here', async () => {
    const hook = await webhook()
    const key = 'shh-signing-key'
    const { r, ring } = runtime()
    await running(r, { webhookUrl: hook.url, signingSecret: key, onlyProblems: false }, [hook.url, key])
    completed(ring)
    await until(() => expect(hook.posts).toHaveLength(1))
    const { text, signature } = hook.posts[0]
    expect(signature).toBe(`sha256=${createHmac('sha256', key).update(text).digest('hex')}`)
  }, 90_000)

  it('leaves out completed Runs when told to post only problems', async () => {
    const hook = await webhook()
    const { r, ring } = runtime()
    await running(r, { webhookUrl: hook.url, onlyProblems: true }, [hook.url])
    completed(ring)
    const e = failed(ring)
    await until(() => expect(hook.bodies).toHaveLength(1))
    expect(hook.bodies[0]).toEqual({ text: 'Run run_1 of job job_1 failed', event: e })
  }, 90_000)

  // Plugin Phase 3: an event plugin is handed what happened while it was stopped
  it('posts what happened while it was stopped once it runs again', async () => {
    const hook = await webhook()
    const { r, ring } = runtime()
    const settings = { webhookUrl: hook.url, onlyProblems: false }
    await running(r, settings, [hook.url])
    await r.stop(ID)
    const e = failed(ring)
    await running(r, settings, [hook.url])
    await until(() => expect(hook.bodies).toEqual([{ text: 'Run run_1 of job job_1 failed', event: e }]))
  }, 90_000)

  it('says so when events were lost while it was stopped, then posts the ones the log still holds', async () => {
    const hook = await webhook()
    const { r, ring } = runtime({ retain: 2 })
    const settings = { webhookUrl: hook.url, onlyProblems: false }
    completed(ring)
    await running(r, settings, [hook.url])
    await r.stop(ID)
    const [, second, third] = [failed(ring), failed(ring), failed(ring)]
    await running(r, settings, [hook.url])
    await until(() => expect(hook.bodies).toHaveLength(3))
    expect(hook.bodies[0]).toEqual({ text: 'Some Astera events were lost (older than the Host keeps): look in the app.', event: { type: 'gap' } })
    expect(hook.bodies.slice(1)).toEqual([expect.objectContaining({ event: second }), expect.objectContaining({ event: third })])
  }, 90_000)

  // 2f final review I3: the runtime calls any exit it asked for a stop, so the log is what tells a quiet stop from one
  // that wrote an error and exited with a failure
  it('stops quietly when Astera stops it', async () => {
    const hook = await webhook()
    const { r } = runtime()
    await running(r, { webhookUrl: hook.url, onlyProblems: false }, [hook.url])
    await r.stop(ID)
    expect(r.status(ID)?.status).toBe('stopped')
    // The log is written a moment after the status changes
    await until(() => expect(logOf(r)).toContain('[host] stopped'))
    const log = logOf(r)
    expect(log).toContain('[host] exited with code 0')
    expect(log).not.toContain('[error]')
    expect(log).not.toContain('did not stop within')
  }, 90_000)

  // 2f final review I2: configuring a failed plugin does not start it, so the message says what does
  it('says how to start it again when its webhook URL is not one', async () => {
    const { r } = runtime({ failAfter: 1 })
    r.start(launch({ webhookUrl: 'hooks.example.com/T0', onlyProblems: false }, ['hooks.example.com/T0']))
    await until(() => expect(r.status(ID)?.status).toBe('failed'))
    await until(() => expect(logOf(r)).toContain('[host] failed: '))
    expect(logOf(r)).toMatch(/astera plugins configure.*astera plugins enable/)
  }, 90_000)

  // 2f final review m12: Slack reads <...> as a mention or a link, so <!channel> in a title would ping a channel
  it('escapes what Slack reads as markup in the text it posts, and leaves the event as it is', async () => {
    const hook = await webhook()
    const { r, ring } = runtime()
    await running(r, { webhookUrl: hook.url, onlyProblems: false }, [hook.url])
    const payload = { taskId: 'task_1', title: '<!channel> & <b>', state: 'exhausted', attempt: 3, maxAttempts: 3, detail: null, failureSummary: null, lastFailure: 'a < b' }
    const e = append(ring, { type: 'completion.exhausted', jobId: 'job_1', runId: 'run_1', taskId: 'task_1', payload })
    await until(() => expect(hook.bodies).toHaveLength(1))
    expect(hook.bodies[0]).toEqual({ text: '"&lt;!channel&gt; &amp; &lt;b&gt;" ran out of repairs: a &lt; b', event: e })
  }, 90_000)
})
