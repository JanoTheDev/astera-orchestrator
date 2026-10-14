// The Host's plugin runtime with the real launcher (bundled once) and real plugin processes (plugin runtime design
// P11-P13): calls go to the orch as the plugin, stderr goes to a redacted log, a crash restarts, a crash loop fails,
// and stop runs deactivate or kills the whole tree. In a folder with a space and Hangul (spec §48).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { removeFixture } from '../../core/testFixtures'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginRuntime, type PluginLaunch, type PluginRuntime, type PluginTimings } from './runtime'
import { bundleLauncher } from '../../pluginHost/testkit'
import { cursorFile, pluginSecrets } from './pluginData'
import { createEventRing, type EventRing } from '../../core/events/eventRing'
import type { EventDraft } from '../../core/orchestration/publicEvents'

let dir: string
let launcher: string
let n = 0
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-runtime 플러그인 '))
  launcher = await bundleLauncher(dir)
}, 60_000)
const started: PluginRuntime[] = []
afterEach(async () => {
  for (const r of started.splice(0)) await r.stopAll()
})
afterAll(async () => {
  await removeFixture(dir)
})

type Call = { cmd: string; args: unknown; sessionId: string; from?: { role: string; plugin?: { id: string; granted: ReadonlySet<string> } }; request?: string }

/** The Host's event log, as the runtime reads it for event plugins (plugin Phase 3). */
const eventLog = (): EventRing => createEventRing({ boot: 'aaaaaaaaaaaa', retainEvents: 2000, retainChars: 1 << 23 })
const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'completed', progress: { done: 2, total: 2 }, questionsOpen: 0 }
/** Appends `count` completed Runs to the log, each with `payload` over the Run. */
const add = (ring: EventRing, count: number, payload: Record<string, unknown> = {}): void =>
  void ring.append(
    Array.from({ length: count }, (): EventDraft => ({ type: 'run.completed', jobId: 'job_1', runId: 'run_1', payload: { ...RUN, ...payload } })),
    'T'
  )

function runtime(timings: Partial<PluginTimings> = {}, extra: { maxLine?: number; profile?: string; ring?: EventRing } = {}) {
  const calls: Call[] = []
  const hostLog: string[] = []
  const profile = extra.profile ?? path.join(dir, `profile ${++n}`)
  const ring = extra.ring ?? eventLog()
  const r = createPluginRuntime({
    profileDir: profile,
    exec: process.execPath,
    launcher,
    env: { ...process.env, ASTERA_SESSION: 'ses-leak', ASTERA_PROFILE_DIR: 'leak' },
    host: () => ({ version: '9.9.9', pid: process.pid, startedAt: 'T', features: ['orch', 'requests'] }),
    orch: {
      call: async (a) => {
        calls.push(a as Call)
        return { status: 200, body: [] }
      }
    },
    log: (m) => hostLog.push(m),
    // A plugin's start is a process spawn: 10 s ran out under the full suite (load-sensitive tests, 2026-10-14), and a
    // crash counted as quick only within 5 s of a start that itself took that long. No test here is about these two
    // budgets; the ones that are set their own.
    timings: { startMs: 60_000, stopGraceMs: 1_000, backoffMs: [50, 50, 50], stableMs: 30_000, failAfter: 3, ...timings },
    events: ring,
    delivery: { retryFirstMs: 50, retryMaxMs: 50 },
    ...(extra.maxLine !== undefined ? { maxLine: extra.maxLine } : {})
  })
  started.push(r)
  return { r, calls, hostLog, profile, ring }
}

/** A plugin folder holding `source` as its entry. */
function plugin(name: string, source: string, file = 'index.mjs'): PluginLaunch {
  const d = path.join(dir, 'plugins', name)
  mkdirSync(d, { recursive: true })
  writeFileSync(path.join(d, file), source)
  return { id: name, version: '1.0.0', folder: name, dir: d, entry: path.join(d, file), granted: ['projects.read'], capabilities: [], settings: {}, redact: [] }
}

/** An `event` plugin (plugin Phase 3): the capability, and the permission it needs. */
const eventPlugin = (name: string, source: string): PluginLaunch => ({ ...plugin(name, source), capabilities: ['event'], granted: ['events.subscribe'] })

const logOf = (r: PluginRuntime, folder: string): string => (existsSync(r.logFile(folder)) ? readFileSync(r.logFile(folder), 'utf8') : '')
// 45 s: three starts and restarts of a real process, under the full suite (load-sensitive tests, 2026-10-14). Every
// test here waits with it at least once, so each gets 90 s: a wait that runs out fails with its assertion's message
// rather than the runner's timeout (final review m9: all of them, on purpose).
const until = <T>(f: () => T, timeout = 45_000): Promise<T> => vi.waitFor(f, { timeout, interval: 25 })
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('createPluginRuntime', () => {
  it('runs a plugin, answers its calls as the plugin, and logs what it prints with secrets redacted', async () => {
    const { r, calls } = runtime()
    const p = plugin(
      'calls',
      `export default {
        async activate(ctx) {
          console.error(JSON.stringify({ token: 'tok-secret-123' }))
          console.error('session ' + (process.env.ASTERA_SESSION ?? 'none') + ' profile ' + (process.env.ASTERA_PROFILE_DIR ?? 'none'))
          const { items } = await ctx.astera.projects.list()
          ctx.log.info('saw ' + items.length)
        }
      }`
    )
    r.start(p)
    await until(() => expect(r.status('calls')).toMatchObject({ status: 'running', pid: expect.any(Number) }))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ cmd: 'projects-list', args: {}, sessionId: '', from: { role: 'plugin', plugin: { id: 'calls' } } })
    expect([...(calls[0].from?.plugin?.granted ?? [])]).toEqual(['projects.read'])
    await until(() => expect(logOf(r, 'calls')).toContain('[host] running'))
    await until(() => expect(logOf(r, 'calls')).toContain('[info] saw 0'))
    const log = logOf(r, 'calls')
    expect(log).toContain('"token":"[redacted]"')
    expect(log).not.toContain('tok-secret-123')
    // No ASTERA_* variable reaches a plugin: it is not an agent session and has its own channel to the Host.
    expect(log).toContain('session none profile none')
    expect(log).toMatch(/\[host\] started pid \d+/)
    expect(log).toContain('[host] running')
  }, 90_000)

  it('restarts a plugin whose activate throws, marks it failed after the third quick crash, and starts it again on restart', async () => {
    const { r } = runtime()
    const p = plugin('throws', `export default { activate() { throw new Error('no token configured') } }`)
    r.start(p)
    await until(() => expect(r.status('throws')?.status).toBe('failed'))
    expect(r.status('throws')?.reason).toBe(
      'activate threw: no token configured (3 times in a row, each within 30 s of starting); see astera plugins logs --id throws'
    )
    // The log is written a moment after: the writer buffers.
    await until(() => expect(logOf(r, 'throws')).toContain('[host] failed: activate threw: no token configured'))
    expect(logOf(r, 'throws').match(/\[host\] restarting in 0\.05 s/g)).toHaveLength(2)
    writeFileSync(p.entry, `export default { activate(ctx) { ctx.log.info('fixed') } }`)
    r.restart(p)
    await until(() => expect(r.status('throws')?.status).toBe('running'))
  }, 90_000)

  // 2b final review M1: what a plugin says when it fails is its own text, and may carry a secret.
  it('redacts what a failing plugin says in its log and its reason, and keeps it out of the Host log', async () => {
    const { r, hostLog } = runtime({ failAfter: 1 })
    const p = plugin('leaks', `export default { activate() { throw new Error('bad config {"token": "tok-secret-9"}') } }`)
    r.start(p)
    await until(() => expect(r.status('leaks')?.status).toBe('failed'))
    expect(r.status('leaks')?.reason).toContain('[redacted]')
    expect(r.status('leaks')?.reason).not.toContain('tok-secret-9')
    await until(() => expect(logOf(r, 'leaks')).toContain('[host] failed:'))
    expect(logOf(r, 'leaks')).not.toContain('tok-secret-9')
    expect(hostLog.join(String.fromCharCode(10))).not.toContain('tok-secret-9')
    expect(hostLog).toContain('plugins: leaks failed; see astera plugins logs --id leaks')
  }, 90_000)

  it('counts only crashes without a steady run between them', async () => {
    const { r } = runtime({ stableMs: 150 })
    const p = plugin('steady', `export default { activate() { setTimeout(() => process.exit(1), 400) } }`)
    r.start(p)
    await until(() => expect(logOf(r, 'steady').match(/\[host\] exited with code 1/g)?.length ?? 0).toBeGreaterThanOrEqual(4), 20_000)
    expect(r.status('steady')?.status).not.toBe('failed')
  }, 90_000)

  // 2b final review I2: a plugin that sends a line without end is stopped before it can grow the Host's memory.
  it('kills a plugin whose message runs past the ceiling, and counts it as a crash', async () => {
    const { r } = runtime({ failAfter: 1 }, { maxLine: 1000 })
    const p = plugin(
      'floods',
      // Written straight to the channel's descriptor: a second socket on fd 3, which the launcher already holds, is
      // refused on macOS and Linux (EEXIST)
      `import { writeSync } from 'node:fs'
      export default {
        activate() {
          writeSync(3, 'x'.repeat(5000))
          return new Promise(() => {})
        }
      }`
    )
    r.start(p)
    await until(() => expect(r.status('floods')?.status).toBe('failed'))
    expect(r.status('floods')?.reason).toMatch(/^it sent the Host a message longer than 1000 characters/)
  }, 90_000)

  it('counts a start that never finishes as a crash', async () => {
    const { r } = runtime({ startMs: 300, failAfter: 1 })
    const p = plugin('hangs', `export default { activate() { return new Promise(() => {}) } }`)
    r.start(p)
    await until(() => expect(r.status('hangs')?.status).toBe('failed'))
    expect(r.status('hangs')?.reason).toMatch(/^it did not finish starting within 0\.3 s/)
  }, 90_000)

  it('stops a plugin with shutdown, so its deactivate runs, and does not restart it', async () => {
    const { r } = runtime()
    const p = plugin('stops', `import { writeFileSync } from 'node:fs'
      export default { activate() {}, deactivate() { writeFileSync('deactivated', 'yes') } }`)
    r.start(p)
    await until(() => expect(r.status('stops')?.status).toBe('running'))
    const pid = r.status('stops')?.pid as number
    await r.stop('stops')
    expect(readFileSync(path.join(p.dir, 'deactivated'), 'utf8')).toBe('yes')
    expect(r.status('stops')?.status).toBe('stopped')
    expect(alive(pid)).toBe(false)
    await new Promise((res) => setTimeout(res, 200))
    expect(r.status('stops')?.status).toBe('stopped')
    await until(() => expect(logOf(r, 'stops')).toContain('[host] stopped'))
  }, 90_000)

  it('kills a plugin that ignores shutdown, and what it started', async () => {
    const { r } = runtime({ stopGraceMs: 300 })
    const p = plugin(
      'stubborn',
      `import { spawn } from 'node:child_process'
      export default {
        activate(ctx) {
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
          ctx.log.info('child ' + child.pid)
        },
        deactivate() { return new Promise(() => {}) }
      }`
    )
    r.start(p)
    const childPid = await until(() => {
      const m = /\[info\] child (\d+)/.exec(logOf(r, 'stubborn'))
      if (!m) throw new Error('no child yet')
      return Number(m[1])
    })
    expect(alive(childPid)).toBe(true)
    await r.stop('stubborn')
    expect(r.status('stubborn')?.status).toBe('stopped')
    await until(() => expect(alive(childPid)).toBe(false), 10_000)
  }, 90_000)

  // 2b final review I4: a plugin that exits cleanly leaves nothing it started behind, on every platform (Windows: the
  // launcher's job object; elsewhere: the Host ends the plugin's process group after every exit).
  it('leaves nothing a plugin started behind when it stops cleanly or crashes', async () => {
    const { r } = runtime({ failAfter: 1 })
    const spawner = (name: string, end: string) =>
      plugin(
        name,
        `import { spawn } from 'node:child_process'
        export default {
          activate(ctx) {
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
            ctx.log.info('child ' + child.pid)
            ${end}
          }
        }`
      )
    const childOf = (folder: string) =>
      until(() => {
        const m = /\[info\] child (\d+)/.exec(logOf(r, folder))
        if (!m) throw new Error('no child yet')
        return Number(m[1])
      })
    r.start(spawner('clean', ''))
    const cleanChild = await childOf('clean')
    await until(() => expect(r.status('clean')?.status).toBe('running'))
    await r.stop('clean')
    await until(() => expect(alive(cleanChild)).toBe(false), 10_000)
    r.start(spawner('crashes', "setTimeout(() => process.exit(1), 300)"))
    const crashChild = await childOf('crashes')
    await until(() => expect(r.status('crashes')?.status).toBe('failed'))
    await until(() => expect(alive(crashChild)).toBe(false), 10_000)
  }, 40_000)

  // 2b final review M2: a removal deletes the log; nothing buffered may write it again afterwards.
  it('forgets the log of a plugin, so it stays deleted', async () => {
    const { r } = runtime()
    const p = plugin('forgotten', `export default { activate(ctx) { ctx.log.info('hello') } }`)
    r.start(p)
    await until(() => expect(r.status('forgotten')?.status).toBe('running'))
    await r.stop('forgotten')
    await r.forget('forgotten')
    const { rmSync: rm } = await import('node:fs')
    rm(r.logFile('forgotten'), { force: true })
    await new Promise((res) => setTimeout(res, 600))
    expect(existsSync(r.logFile('forgotten'))).toBe(false)
  }, 90_000)

  // Plugins 2c (spec §23-§24): settings handed over at the start, secrets kept per plugin and out of its log.
  it('hands a plugin its settings, keeps its secrets from another plugin, and redacts every secret from its log', async () => {
    const { r } = runtime()
    const keeper = plugin(
      'keeper',
      `export default {
        async activate(ctx) {
          console.error('token is ' + ctx.settings.token + ', page ' + ctx.settings.pageSize)
          await ctx.secrets.set('refresh', 'refresh-secret-77')
          console.error('kept ' + (await ctx.secrets.get('refresh')))
          try { await ctx.secrets.set('../escape', 'x') } catch (e) { console.error('refused: ' + e.message) }
        }
      }`
    )
    r.start({ ...keeper, settings: { token: 'tok-secret-55', pageSize: 50 }, redact: ['tok-secret-55'] })
    await until(() => expect(r.status('keeper')?.status).toBe('running'))
    await until(() => expect(logOf(r, 'keeper')).toContain('refused:'))
    const log = logOf(r, 'keeper')
    expect(log).toContain('token is [redacted], page 50')
    expect(log).toContain('kept [redacted]')
    expect(log).not.toContain('tok-secret-55')
    expect(log).not.toContain('refresh-secret-77')
    expect(log).toMatch(/refused: \.\.\/escape is not a secret name/)
    r.start(plugin('other', `export default { async activate(ctx) { console.error('sees ' + (await ctx.secrets.get('refresh'))) } }`))
    await until(() => expect(logOf(r, 'other')).toContain('sees undefined'))
  }, 90_000)

  it('stops every plugin at once, starts a running plugin only once, and stops an unknown id quietly', async () => {
    const { r } = runtime()
    const a = plugin('one', `export default { activate() {} }`)
    const b = plugin('two', `export default { activate() {} }`)
    r.start(a)
    r.start(b)
    await until(() => expect([r.status('one')?.status, r.status('two')?.status]).toEqual(['running', 'running']))
    const pid = r.status('one')?.pid
    r.start(a)
    expect(r.status('one')?.pid).toBe(pid)
    await r.stop('nobody')
    expect(r.status('nobody')).toBeUndefined()
    await r.stopAll()
    expect([r.status('one')?.status, r.status('two')?.status]).toEqual(['stopped', 'stopped'])
  }, 90_000)

  // Plugin Phase 3, found under onEvent: on Windows the plugin's end of a 'pipe' channel is a synchronous handle, whose
  // pending read holds every write until the Host writes again, so a call a plugin made from a timer waited for the
  // Host's next message, for ever when none came
  it('takes a call the plugin makes from a timer, with nothing else said on the channel', async () => {
    const { r, calls } = runtime()
    const p = plugin('ticks', `export default { activate(ctx) { setTimeout(() => ctx.astera.projects.list().then(() => ctx.log.info('listed')), 300) } }`)
    r.start(p)
    await until(() => expect(r.status('ticks')?.status).toBe('running'))
    await until(() => expect(logOf(r, 'ticks')).toContain('[info] listed'), 10_000)
    expect(calls.map((c) => c.cmd)).toEqual(['projects-list'])
  }, 90_000)
})

// 2c final review C1, I2, I3, I4, M11, M15: no secret of a plugin reaches its log or a reason a person reads.
describe('what a plugin log and reason never show', () => {
  it('hides a secret kept in an earlier run that a plugin with no settings reads and prints', async () => {
    const { r, profile } = runtime()
    mkdirSync(profile, { recursive: true })
    await pluginSecrets(profile, 'earlier').secret.set('oauth', 'oauth-kept-earlier-31')
    r.start(plugin('earlier', `export default { async activate(ctx) { console.error('read ' + (await ctx.secrets.get('oauth'))) } }`))
    await until(() => expect(logOf(r, 'earlier')).toContain('read '))
    expect(logOf(r, 'earlier')).toContain('read [redacted]')
    expect(logOf(r, 'earlier')).not.toContain('oauth-kept-earlier-31')
  }, 90_000)

  it('keeps hiding a secret the plugin set before it crashed, after the restart', async () => {
    const { r } = runtime()
    const p = plugin(
      'crashy',
      `import { existsSync, readFileSync, writeFileSync } from 'node:fs'
      export default {
        async activate(ctx) {
          if (existsSync('cache.txt')) { console.error('cached ' + readFileSync('cache.txt', 'utf8')); return }
          await ctx.secrets.set('refresh', 'refresh-before-crash-42')
          writeFileSync('cache.txt', 'refresh-before-crash-42')
          process.exit(1)
        }
      }`
    )
    r.start(p)
    await until(() => expect(logOf(r, 'crashy')).toContain('cached '))
    expect(logOf(r, 'crashy')).toContain('cached [redacted]')
    expect(logOf(r, 'crashy')).not.toContain('refresh-before-crash-42')
  }, 90_000)

  it('hides a secret in the reason of a failed plugin and of one waiting to restart', async () => {
    const source = `export default { activate(ctx) { throw new Error('401 for ' + ctx.settings.password) } }`
    const secret = { settings: { password: 'hunter2-plain' }, redact: ['hunter2-plain'] }
    const { r } = runtime({ failAfter: 1 })
    r.start({ ...plugin('says', source), ...secret })
    await until(() => expect(r.status('says')?.status).toBe('failed'))
    expect(r.status('says')?.reason).toContain('activate threw: 401 for [redacted]')
    const { r: waiting } = runtime({ backoffMs: [60_000] })
    waiting.start({ ...plugin('waits', source), ...secret })
    await until(() => expect(waiting.status('waits')?.reason).toBeDefined())
    expect(waiting.status('waits')?.reason).toBe('restarting after activate threw: 401 for [redacted]')
  }, 90_000)

  it('hides each line of a secret of many lines, and a secret as JSON writes it', async () => {
    const { r } = runtime()
    const key = '-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0\nBAQEFAASCBKcwggSjAgEAAo\n-----END KEY-----'
    const phrase = 'say "open" \\ sesame-77'
    const p = plugin('pem', `export default { activate(ctx) { console.error(ctx.settings.key); console.error(JSON.stringify(ctx.settings)) } }`)
    r.start({ ...p, settings: { key, phrase }, redact: [key, phrase] })
    await until(() => expect(logOf(r, 'pem')).toContain('"phrase"'))
    const log = logOf(r, 'pem')
    for (const leak of ['MIIEvQIBADANBgkqhkiG9w0', 'BAQEFAASCBKcwggSjAgEAAo', 'sesame-77']) expect(log, leak).not.toContain(leak)
  }, 90_000)

  it('hides a secret that holds a shorter one whole', async () => {
    const { r } = runtime()
    const p = plugin('nested', `export default { activate() { console.error('long abcd-long-secret, short abcd') } }`)
    r.start({ ...p, redact: ['abcd', 'abcd-long-secret'] })
    await until(() => expect(logOf(r, 'nested')).toContain('long '))
    expect(logOf(r, 'nested')).toContain('long [redacted], short [redacted]')
  }, 90_000)

  it('hides the last value set under a secret name, not every value it ever held', async () => {
    const { r } = runtime()
    const p = plugin(
      'cursor',
      `export default {
        async activate(ctx) {
          for (let i = 0; i < 3; i++) await ctx.secrets.set('cursor', 'cursor-value-' + String(i).padStart(3, '0'))
          console.error('first cursor-value-000, last cursor-value-002')
        }
      }`
    )
    r.start(p)
    await until(() => expect(logOf(r, 'cursor')).toContain('first '))
    expect(logOf(r, 'cursor')).toContain('first cursor-value-000, last [redacted]')
  }, 90_000)
})

describe('event plugins (plugin Phase 3 N1, N5-N8)', () => {
  const ON_EVENT = `export default {
    async onEvent(e, ctx) {
      if (e.type !== 'gap' && e.payload.boom) throw new Error('boom ' + ctx.settings.token)
      ctx.log.info('got ' + (e.type === 'gap' ? 'gap' : e.id))
    }
  }`
  /** Ends its process the first time it sees the second event, then takes every event. */
  const CRASH_ONCE_ON_2 = `import { existsSync, writeFileSync } from 'node:fs'
  import path from 'node:path'
  export default {
    onEvent(e, ctx) {
      const marker = path.join(ctx.plugin.dir, 'crashed')
      if (e.type !== 'gap' && e.id === 'ev_aaaaaaaaaaaa_2' && !existsSync(marker)) {
        writeFileSync(marker, '1')
        process.exit(1)
      }
      ctx.log.info('got ' + (e.type === 'gap' ? 'gap' : e.id))
    }
  }`

  it('hands a running event plugin what comes after its start, in order, and keeps its place in a file', async () => {
    const { r, profile, ring } = runtime()
    add(ring, 1)
    r.start(eventPlugin('ev1', ON_EVENT))
    await until(() => expect(r.status('ev1')?.status).toBe('running'))
    add(ring, 2)
    await until(() => expect(logOf(r, 'ev1')).toMatch(/got ev_aaaaaaaaaaaa_2[\s\S]*got ev_aaaaaaaaaaaa_3/))
    expect(logOf(r, 'ev1')).not.toContain('got ev_aaaaaaaaaaaa_1')
    await r.stop('ev1')
    expect(JSON.parse(readFileSync(cursorFile(profile, 'ev1'), 'utf8'))).toEqual({ version: 1, cursor: 'ev_aaaaaaaaaaaa_3' })
  }, 90_000)

  // Review Focus 4
  it('resumes where it left off after a crash, and after the Host starts again', async () => {
    const first = runtime()
    add(first.ring, 1)
    const p = eventPlugin('ev2', CRASH_ONCE_ON_2)
    first.r.start(p)
    await until(() => expect(first.r.status('ev2')?.status).toBe('running'))
    add(first.ring, 2)
    await until(() => expect(logOf(first.r, 'ev2')).toMatch(/got ev_aaaaaaaaaaaa_2[\s\S]*got ev_aaaaaaaaaaaa_3/))
    expect(logOf(first.r, 'ev2')).toContain('restarting in')
    await first.r.stopAll()
    const again = runtime({}, { profile: first.profile, ring: first.ring })
    add(first.ring, 1)
    again.r.start(p)
    await until(() => expect(logOf(again.r, 'ev2')).toContain('got ev_aaaaaaaaaaaa_4'))
    expect(logOf(again.r, 'ev2').match(/got ev_aaaaaaaaaaaa_3/g)).toHaveLength(1)
  }, 90_000)

  // Review Focus 5
  it('logs a failed delivery with its secrets hidden, and tries it again', async () => {
    const { r, ring } = runtime()
    r.start({ ...eventPlugin('ev3', ON_EVENT), settings: { token: 'tok-secret-123' }, redact: ['tok-secret-123'] })
    await until(() => expect(r.status('ev3')?.status).toBe('running'))
    add(ring, 1, { boom: true })
    await until(() => expect(logOf(r, 'ev3')).toContain('[host] delivering run.completed ev_aaaaaaaaaaaa_1 failed (try 1): onEvent threw: boom [redacted]'))
    expect(logOf(r, 'ev3')).not.toContain('tok-secret-123')
  }, 90_000)

  it('fails the start of an event plugin whose entry has no onEvent, saying so', async () => {
    const { r } = runtime({ failAfter: 1 })
    r.start(eventPlugin('ev4', 'export default { activate() {} }'))
    await until(() => expect(r.status('ev4')).toMatchObject({ status: 'failed', reason: expect.stringContaining('the event capability needs an onEvent in its entry') }))
  }, 90_000)

  it('does not start an event plugin that was not granted events.subscribe', async () => {
    const { r } = runtime({ failAfter: 1 })
    r.start({ ...eventPlugin('ev5', ON_EVENT), granted: [] })
    await until(() =>
      expect(r.status('ev5')).toMatchObject({ status: 'failed', reason: expect.stringContaining('the event capability needs the events.subscribe permission') })
    )
  }, 90_000)

  // The answer of an onEvent that awaits something is written after the Host's message was read, the case the
  // channel's synchronous handle held until the next message (see 'takes a call the plugin makes from a timer')
  it('takes the answer of an onEvent that settles later, and goes on to the next event at once', async () => {
    const { r, profile, ring } = runtime()
    r.start(eventPlugin('ev7', `export default { async onEvent(e, ctx) { await new Promise((res) => setTimeout(res, 50)); ctx.log.info('got ' + e.id) } }`))
    await until(() => expect(r.status('ev7')?.status).toBe('running'))
    add(ring, 2)
    await until(() => expect(logOf(r, 'ev7')).toContain('got ev_aaaaaaaaaaaa_2'), 10_000)
    await r.stop('ev7')
    expect(JSON.parse(readFileSync(cursorFile(profile, 'ev7'), 'utf8')).cursor).toBe('ev_aaaaaaaaaaaa_2')
    expect(logOf(r, 'ev7')).not.toContain('did not finish within')
  }, 90_000)

  // Review Focus 1
  it('stops a plugin whose onEvent never settles within its grace', async () => {
    const { r, ring } = runtime()
    r.start(eventPlugin('ev6', `export default { onEvent(e, ctx) { ctx.log.info('holding'); return new Promise(() => {}) } }`))
    await until(() => expect(r.status('ev6')?.status).toBe('running'))
    add(ring, 1)
    await until(() => expect(logOf(r, 'ev6')).toContain('holding'))
    const t0 = Date.now()
    await r.stop('ev6')
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(r.status('ev6')?.status).toBe('stopped')
  }, 90_000)
})
