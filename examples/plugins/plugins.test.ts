// The sample plugins as a person uses them (plugins 2f): each manifest is one Astera installs, each plugin imports only
// Node's own modules so its folder installs as it is, it typechecks against the SDK's types, and it runs in the real
// plugin runtime (the launcher bundled, a process of its own) against a Host that answers what it asks.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../../src/core/plugins/manifest'
import { createPluginRuntime, type PluginRuntime } from '../../src/host/plugins/runtime'
import { bundleLauncher } from '../../src/pluginHost/testkit'
import { runTsc } from '../../packages/client/test/typecheck'

const here = path.dirname(fileURLToPath(import.meta.url))
const NOTIFIER = path.join(here, 'webhook-notifier')
const ID = 'astera-webhook-notifier'

let work: string
let launcher: string
beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), 'astera plugin samples '))
  launcher = await bundleLauncher(work)
}, 60_000)
afterAll(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 5 })
})
const started: PluginRuntime[] = []
const servers: http.Server[] = []
afterEach(async () => {
  for (const r of started.splice(0)) await r.stopAll()
  for (const s of servers.splice(0)) await new Promise((res) => s.close(() => res(undefined)))
})

const until = <T>(f: () => T, timeout = 20_000): Promise<T> => vi.waitFor(f, { timeout, interval: 25 })

/** A webhook that answers with `statuses` in turn (200 once they run out), and keeps what it was sent. */
async function webhook(statuses: number[] = []) {
  const bodies: unknown[] = []
  const server = http.createServer((req, res) => {
    let text = ''
    req.setEncoding('utf8').on('data', (c: string) => (text += c))
    req.on('end', () => {
      const status = statuses.shift() ?? 200
      if (status === 200) bodies.push(JSON.parse(text))
      res.writeHead(status)
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/T0/B0/secret-part`, bodies }
}

const A = 'aaaaaaaaaaaa'
const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'completed', progress: { done: 2, total: 2 }, questionsOpen: 0 }
const completed = { id: `ev_${A}_2`, type: 'run.completed', sequence: 2, occurredAt: 'T', jobId: 'job_1', runId: 'run_1', payload: RUN }

/** A Host that answers the plugin's events-poll: the tail's cursor, then `pages` in turn, then empty pages a moment apart. */
function events(pages: Array<{ status: number; body: unknown }>) {
  const polls: Record<string, unknown>[] = []
  return {
    polls,
    call: async (a: { cmd: string; args: Record<string, unknown> }) => {
      if (a.cmd !== 'events-poll') return { status: 404, body: { error: `no ${a.cmd} here` } }
      polls.push(a.args)
      if (a.args.tail === true) return { status: 200, body: { events: [], cursor: `ev_${A}_1`, gap: false } }
      const next = pages.shift()
      if (next) return next
      await new Promise((r) => setTimeout(r, 100))
      return { status: 200, body: { events: [], cursor: `ev_${A}_2`, gap: false } }
    }
  }
}

function runtime(host: ReturnType<typeof events>, failAfter = 3) {
  const r = createPluginRuntime({
    profileDir: path.join(work, `profile ${started.length + Math.random()}`),
    exec: process.execPath,
    launcher,
    env: process.env,
    host: () => ({ version: '9.9.9', pid: process.pid, startedAt: 'T', features: ['orch', 'requests', 'events'] }),
    orch: { call: host.call as never },
    log: () => {},
    timings: { startMs: 10_000, stopGraceMs: 2_000, backoffMs: [50, 50], stableMs: 5_000, failAfter }
  })
  started.push(r)
  return r
}

const launch = (settings: Record<string, string | number | boolean>, redact: string[]) => ({
  id: ID,
  version: '0.1.0',
  folder: ID,
  dir: NOTIFIER,
  entry: path.join(NOTIFIER, 'index.mjs'),
  granted: ['events.subscribe'],
  settings,
  redact
})
const logOf = (r: PluginRuntime): string => (existsSync(r.logFile(ID)) ? readFileSync(r.logFile(ID), 'utf8') : '')

describe('the webhook notifier sample', () => {
  it('is a manifest Astera installs: one permission, a secret webhook URL it needs, and a choice', () => {
    const read = parseManifest(JSON.parse(readFileSync(path.join(NOTIFIER, 'package.json'), 'utf8')))
    if (!read.ok) throw new Error(read.problems.join('; '))
    expect(read.manifest).toMatchObject({ id: ID, apiVersion: '1', entry: 'index.mjs', permissions: ['events.subscribe'], capabilities: [] })
    expect(read.manifest.settings).toEqual([
      expect.objectContaining({ key: 'webhookUrl', type: 'string', secret: true, required: true }),
      expect.objectContaining({ key: 'onlyProblems', type: 'boolean', default: false, required: false })
    ])
  })

  it('imports only Node’s own modules, so its folder installs as it is', () => {
    const code = readFileSync(path.join(NOTIFIER, 'index.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const specifiers = [...code.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)].map((m) => m[1] ?? m[2])
    expect(specifiers.filter((s) => !s.startsWith('node:'))).toEqual([])
  })

  it('typechecks against the plugin SDK’s types', () => {
    expect(runTsc(path.join(here, 'tsconfig.json'))).toBe('')
  }, 60_000)

  it('posts a completed Run to the webhook, tries a failed post again, and keeps the URL out of its log', async () => {
    const hook = await webhook([500])
    const host = events([{ status: 200, body: { events: [completed], cursor: `ev_${A}_2`, gap: false } }])
    const r = runtime(host)
    r.start(launch({ webhookUrl: hook.url, onlyProblems: false }, [hook.url]))
    await until(() => expect(hook.bodies).toHaveLength(1))
    expect(hook.bodies[0]).toEqual({ text: 'Run run_1 of job job_1 completed (2 of 2 tasks)', event: completed })
    expect(host.polls[1]).toMatchObject({ after: `ev_${A}_1`, types: 'run.completed,run.failed,completion.exhausted,question.created' })
    await until(() => expect(logOf(r)).toContain(`posted run.completed ev_${A}_2`))
    expect(logOf(r)).not.toContain('secret-part')
  }, 30_000)

  it('asks only for problems when told to', async () => {
    const hook = await webhook()
    const host = events([])
    const r = runtime(host)
    r.start(launch({ webhookUrl: hook.url, onlyProblems: true }, [hook.url]))
    await until(() => expect(host.polls.length).toBeGreaterThanOrEqual(2))
    expect(host.polls[1]).toMatchObject({ types: 'run.failed,completion.exhausted,question.created' })
  }, 30_000)

  it('stops when Astera stops it', async () => {
    const hook = await webhook()
    const r = runtime(events([]))
    r.start(launch({ webhookUrl: hook.url, onlyProblems: false }, [hook.url]))
    await until(() => expect(r.status(ID)?.status).toBe('running'))
    const pid = r.status(ID)?.pid
    await r.stop(ID)
    expect(r.status(ID)?.status).toBe('stopped')
    expect(pid).toBeDefined()
  }, 30_000)

  it('ends itself when the Host refuses its subscription, so Astera restarts it and in the end marks it failed', async () => {
    const hook = await webhook()
    const refused = { status: 403, body: { error: 'events-poll needs the events.subscribe permission, which plugin astera-webhook-notifier was not granted' } }
    const r = runtime(events([refused]), 1)
    r.start(launch({ webhookUrl: hook.url, onlyProblems: false }, [hook.url]))
    await until(() => expect(r.status(ID)?.status).toBe('failed'))
    await until(() => expect(logOf(r)).toContain('[error] stopped: '))
  }, 30_000)
})
