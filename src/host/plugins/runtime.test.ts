// The Host's plugin runtime with the real launcher (bundled once) and real plugin processes (plugin runtime design
// P11-P13): calls go to the orch as the plugin, stderr goes to a redacted log, a crash restarts, a crash loop fails,
// and stop runs deactivate or kills the whole tree. In a folder with a space and Hangul (spec §48).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { removeFixture } from '../../core/testFixtures'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PluginRequestFailed, createPluginRuntime, type PluginLaunch, type PluginRuntime, type PluginTimings } from './runtime'
import type { DeliveryTimings } from './deliverer'
import type { AsteraEvent } from '../../core/publicContract'
import type { PluginNotification } from '../../core/plugins/notifications'
import { bundleLauncher } from '../../pluginHost/testkit'
import { cursorFile, pluginSecrets, type CursorStore } from './pluginData'
import { createEventRing, type EventRing } from '../../core/events/eventRing'
import { notificationOf } from '../../core/plugins/notifications'
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

function runtime(
  timings: Partial<PluginTimings> = {},
  extra: {
    maxLine?: number
    profile?: string
    ring?: EventRing
    cursors?: (folder: string) => CursorStore
    notify?: (e: AsteraEvent) => PluginNotification | null | Promise<PluginNotification | null>
    delivery?: Partial<DeliveryTimings>
    now?: () => number
  } = {}
) {
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
    delivery: { retryFirstMs: 50, retryMaxMs: 50, ...extra.delivery },
    // Worded as the Host words them, in English, every Job's objective "Ship it"
    notify: extra.notify ?? ((e) => notificationOf(e, { lang: 'en', objectiveOf: () => 'Ship it' })),
    ...(extra.now ? { now: extra.now } : {}),
    ...(extra.maxLine !== undefined ? { maxLine: extra.maxLine } : {}),
    ...(extra.cursors ? { cursors: extra.cursors } : {})
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

/** A `notification` plugin (plugin Phase 3c): the capability, and the permission it needs. */
const provider = (name: string, source: string): PluginLaunch => ({ ...plugin(name, source), capabilities: ['notification'], granted: ['events.subscribe'] })

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
    // The next Host (final review M9): a boot of its own, and the log read back from what the first one wrote, as
    // eventLog.ts reads its segments at a start
    const ring = createEventRing({ boot: 'bbbbbbbbbbbb', retainEvents: 2000, retainChars: 1 << 23 })
    const held = first.ring.read({ limit: 1000 })
    if ('error' in held) throw new Error(held.error)
    ring.restore(held.events.map((event) => ({ event, line: JSON.stringify(event) })))
    const again = runtime({}, { profile: first.profile, ring })
    add(ring, 1)
    again.r.start(p)
    await until(() => expect(logOf(again.r, 'ev2')).toContain('got ev_bbbbbbbbbbbb_4'))
    expect(logOf(again.r, 'ev2').match(/got ev_aaaaaaaaaaaa_3/g)).toHaveLength(1)
    expect(logOf(again.r, 'ev2')).not.toContain('got gap')
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
    await until(() => expect(r.status('ev4')).toMatchObject({ status: 'failed', reason: expect.stringContaining('the event capability needs onEvent in its entry') }))
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

  /** A cursor store whose second write waits for `release()`, and the order of what it was asked. */
  const gatedCursors = () => {
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => (release = res))
    let writes = 0
    const store: CursorStore = {
      read: async () => {
        order.push('read')
        return null
      },
      write: async (c) => {
        writes += 1
        order.push(`write ${c}`)
        if (writes === 2) await gate
        order.push(`wrote ${c}`)
      }
    }
    return { order, release: () => release(), cursors: () => store }
  }

  // Final review M4: the stop's promise is not the only one that waits for the deliverer's last write
  it('makes a second stop wait for the cursor write the first one began', async () => {
    const c = gatedCursors()
    const { r, ring } = runtime({}, { cursors: c.cursors })
    r.start(eventPlugin('ev8', `export default { onEvent(e, ctx) { ctx.log.info('got ' + e.id) } }`))
    await until(() => expect(r.status('ev8')?.status).toBe('running'))
    add(ring, 1)
    await until(() => expect(c.order).toContain('write ev_aaaaaaaaaaaa_1'))
    void r.stop('ev8')
    let second = false
    void r.stop('ev8').then(() => (second = true))
    await until(() => expect(r.status('ev8')?.status).toBe('stopped'))
    await new Promise((res) => setTimeout(res, 300))
    expect(second).toBe(false)
    c.release()
    await until(() => expect(second).toBe(true))
  }, 90_000)

  it('starts a plugin again only once the cursor write of its stop has landed', async () => {
    const c = gatedCursors()
    const { r, ring } = runtime({}, { cursors: c.cursors })
    const p = eventPlugin('ev9', `export default { onEvent(e, ctx) { ctx.log.info('got ' + e.id) } }`)
    r.start(p)
    await until(() => expect(r.status('ev9')?.status).toBe('running'))
    add(ring, 1)
    await until(() => expect(c.order).toContain('write ev_aaaaaaaaaaaa_1'))
    void r.stop('ev9')
    await until(() => expect(r.status('ev9')?.status).toBe('stopped'))
    r.start(p)
    await new Promise((res) => setTimeout(res, 300))
    expect(c.order.filter((x) => x === 'read')).toHaveLength(1)
    c.release()
    await until(() => expect(c.order.filter((x) => x === 'read')).toHaveLength(2))
    expect(c.order.indexOf('wrote ev_aaaaaaaaaaaa_1')).toBeLessThan(c.order.lastIndexOf('read'))
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

describe('notification plugins (plugin Phase 3 N1, N9, N10)', () => {
  const SEND = `export default { send(n, ctx) { ctx.log.info('sent ' + n.kind + ' ' + n.level + ' ' + n.title + ': ' + n.body + ' ' + n.id) } }`
  /** Appends one event of `type` at `occurredAt`. */
  const append = (ring: EventRing, type: string, occurredAt = new Date().toISOString(), payload: unknown = RUN): void =>
    void ring.append([{ type, jobId: 'job_1', runId: 'run_1', payload } as EventDraft], occurredAt)

  it('hands a provider each notification, worded, and nothing for other events', async () => {
    const { r, ring } = runtime()
    r.start(provider('n1', SEND))
    await until(() => expect(r.status('n1')?.status).toBe('running'))
    append(ring, 'job.created', undefined, { id: 'job_1', objective: 'Ship it' })
    append(ring, 'run.completed')
    await until(() => expect(logOf(r, 'n1')).toContain('sent run.completed info Ship it: Run 1 finished. ev_aaaaaaaaaaaa_2'))
    expect(logOf(r, 'n1').match(/\[info\] sent /g)).toHaveLength(1)
  }, 90_000)

  it('calls onEvent, then send, for a plugin that names both', async () => {
    const { r, ring } = runtime()
    const both = `export default {
      onEvent(e, ctx) { ctx.log.info('event ' + e.id) },
      send(n, ctx) { ctx.log.info('sent ' + n.id) }
    }`
    r.start({ ...provider('n2', both), capabilities: ['event', 'notification'] })
    await until(() => expect(r.status('n2')?.status).toBe('running'))
    append(ring, 'run.completed')
    await until(() => expect(logOf(r, 'n2')).toContain('sent ev_aaaaaaaaaaaa_1'))
    expect(logOf(r, 'n2')).toMatch(/event ev_aaaaaaaaaaaa_1[\s\S]*sent ev_aaaaaaaaaaaa_1/)
  }, 90_000)

  // Review Focus 1
  it('skips notifications older than an hour, counting them in one line, and sends the fresh ones', async () => {
    const { r, ring } = runtime()
    r.start(provider('n3', SEND))
    await until(() => expect(r.status('n3')?.status).toBe('running'))
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    for (let i = 0; i < 3; i++) append(ring, 'run.completed', old)
    append(ring, 'run.failed', undefined, { ...RUN, outcome: 'failed' })
    await until(() => expect(logOf(r, 'n3')).toContain('sent run.failed error Ship it'))
    const log = logOf(r, 'n3')
    expect(log.match(/skipped/g)).toHaveLength(1)
    expect(log).toContain('[host] skipped 3 notifications older than an hour (ev_aaaaaaaaaaaa_1 to ev_aaaaaaaaaaaa_3)')
    expect(log).not.toContain('sent run.completed')
  }, 90_000)

  it('counts the stale ones once it has caught up, when no fresh one follows', async () => {
    const { r, ring } = runtime()
    r.start(provider('n4', SEND))
    await until(() => expect(r.status('n4')?.status).toBe('running'))
    append(ring, 'run.completed', new Date(Date.now() - 2 * 60 * 60_000).toISOString())
    await until(() => expect(logOf(r, 'n4')).toContain('[host] skipped 1 notification older than an hour (ev_aaaaaaaaaaaa_1)'))
  }, 90_000)

  it('logs a gap for a provider, and hands it nothing', async () => {
    const { r } = runtime({}, { cursors: () => ({ read: async () => 'ev_bbbbbbbbbbbb_9', write: async () => {} }) })
    r.start(provider('n5', SEND))
    await until(() => expect(logOf(r, 'n5')).toContain('[host] events were lost before the next one (older than the log keeps): no notification was sent for them'))
    expect(logOf(r, 'n5')).not.toContain('[info] sent')
  }, 90_000)

  it('fails the start of a provider whose entry has no send, saying so', async () => {
    const { r } = runtime({ failAfter: 1 })
    r.start(provider('n6', 'export default { onEvent() {} }'))
    await until(() => expect(r.status('n6')).toMatchObject({ status: 'failed', reason: expect.stringContaining('the notification capability needs send in its entry') }))
  }, 90_000)
})

describe('notification plugins, against what a person would not expect (plugin 3c final review)', () => {
  const word = (e: AsteraEvent): PluginNotification | null => notificationOf(e, { lang: 'en', objectiveOf: () => 'Ship it' })
  const append = (ring: EventRing, occurredAt = new Date().toISOString()): void =>
    void ring.append([{ type: 'run.completed', jobId: 'job_1', runId: 'run_1', payload: RUN } as EventDraft], occurredAt)

  // I1: a wording that fails is the Host's fault, not the plugin's, and retrying it changes nothing
  it('sends nothing for an event it cannot word, says so, and goes on at once', async () => {
    const notify = (e: AsteraEvent) => {
      if (e.sequence === 1) throw new Error('bad payload')
      return word(e)
    }
    const { r, ring } = runtime({}, { notify })
    r.start(provider('w1', `export default { send(n, ctx) { ctx.log.info('sent ' + n.id) } }`))
    await until(() => expect(r.status('w1')?.status).toBe('running'))
    append(ring)
    append(ring)
    await until(() => expect(logOf(r, 'w1')).toContain('sent ev_aaaaaaaaaaaa_2'))
    expect(logOf(r, 'w1')).toContain('[host] could not word run.completed ev_aaaaaaaaaaaa_1 (bad payload): it is not sent')
    expect(logOf(r, 'w1')).not.toContain('failed (try')
  }, 90_000)

  // M2: an attempt the deliverer gave up at the time limit must not go on to send beside the next try
  it('does not send for an attempt that ran past the time limit', async () => {
    const { r, ring } = runtime({}, { delivery: { timeoutMs: 300 } })
    const source = `import { existsSync, writeFileSync } from 'node:fs'
      import path from 'node:path'
      export default {
        async onEvent(e, ctx) {
          const m = path.join(ctx.plugin.dir, 'slow')
          if (!existsSync(m)) { writeFileSync(m, '1'); await new Promise((res) => setTimeout(res, 800)) }
        },
        send(n, ctx) { ctx.log.info('sent ' + n.id) }
      }`
    r.start({ ...provider('w2', source), capabilities: ['event', 'notification'] })
    await until(() => expect(r.status('w2')?.status).toBe('running'))
    append(ring)
    await until(() => expect(logOf(r, 'w2')).toContain('sent ev_aaaaaaaaaaaa_1'))
    await new Promise((res) => setTimeout(res, 1500))
    expect(logOf(r, 'w2').match(/sent ev_aaaaaaaaaaaa_1/g)).toHaveLength(1)
  }, 90_000)

  // M4: a notification that was fresh when it was first sent is tried until it is sent or given up, not skipped as stale
  it('keeps trying a notification that grows old while it fails, rather than counting it stale', async () => {
    const { r, ring } = runtime()
    r.start(provider('w3', `let n = 0; export default { send(no, ctx) { if (++n <= 5) throw new Error('down'); ctx.log.info('sent ' + no.id) } }`))
    await until(() => expect(r.status('w3')?.status).toBe('running'))
    append(ring, new Date(Date.now() - 60 * 60_000 + 100).toISOString())
    await until(() => expect(logOf(r, 'w3')).toContain('sent ev_aaaaaaaaaaaa_1'))
    expect(logOf(r, 'w3')).not.toContain('skipped')
  }, 90_000)

  // 3c final review, re-graded from "declined": the give-up hour is the deliverer's own forward-only clock (3b M1)
  it('counts the give-up hour on the deliverer’s own clock, not the runtime’s', async () => {
    let skew = 0
    const { r, ring } = runtime({}, { now: () => Date.now() + skew, delivery: { retryFirstMs: 1_000, retryMaxMs: 1_000 } })
    r.start(eventPlugin('w4', `let n = 0; export default { onEvent(e, ctx) { if (++n <= 2) throw new Error('down ' + n); ctx.log.info('got ' + e.id) } }`))
    await until(() => expect(r.status('w4')?.status).toBe('running'))
    add(ring, 1)
    await until(() => expect(logOf(r, 'w4')).toContain('failed (try 1)'))
    skew = 2 * 60 * 60_000
    await until(() => expect(logOf(r, 'w4')).toContain('got ev_aaaaaaaaaaaa_1'))
    expect(logOf(r, 'w4')).not.toContain('gave up')
  }, 90_000)

  // M10: the stop says the stale ones still uncounted
  it('counts the stale notifications at the stop when nothing else has', async () => {
    const { r, ring } = runtime()
    const source = `export default {
      onEvent(e) { if (e.sequence === 3) return new Promise(() => {}) },
      send(n, ctx) { ctx.log.info('sent ' + n.id) }
    }`
    r.start({ ...provider('w5', source), capabilities: ['event', 'notification'] })
    await until(() => expect(r.status('w5')?.status).toBe('running'))
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    append(ring, old)
    append(ring, old)
    append(ring)
    await new Promise((res) => setTimeout(res, 500))
    expect(logOf(r, 'w5')).not.toContain('skipped')
    await r.stop('w5')
    await until(() => expect(logOf(r, 'w5')).toContain('[host] skipped 2 notifications older than an hour (ev_aaaaaaaaaaaa_1 to ev_aaaaaaaaaaaa_2)'))
  }, 90_000)

  // M10: the ruling that a failed send hands the whole event over again, onEvent included
  it('hands a plugin that names both onEvent again when its send failed', async () => {
    const { r, ring } = runtime()
    const source = `let n = 0; export default {
      onEvent(e, ctx) { ctx.log.info('event ' + e.id) },
      send(no, ctx) { if (++n === 1) throw new Error('down'); ctx.log.info('sent ' + no.id) }
    }`
    r.start({ ...provider('w6', source), capabilities: ['event', 'notification'] })
    await until(() => expect(r.status('w6')?.status).toBe('running'))
    append(ring)
    await until(() => expect(logOf(r, 'w6')).toContain('sent ev_aaaaaaaaaaaa_1'))
    expect(logOf(r, 'w6').match(/event ev_aaaaaaaaaaaa_1/g)).toHaveLength(2)
  }, 90_000)
})

describe('job-source plugins (plugin Phase 4 J6, J8)', () => {
  const SOURCE = `export default {
    listItems(input) { return { items: [{ id: 'ENG-1', title: 'Fix ' + (input.query ?? '') }] } },
    getItem(id) { if (id === 'boom') throw new Error('401 Unauthorized'); return { id, title: 'Fix' } },
    buildJobContext(id) { return new Promise(() => {}) }
  }`
  const sourcePlugin = (name: string, source = SOURCE): PluginLaunch => ({ ...plugin(name, source), capabilities: ['job-source'], granted: [] })
  /** The failure `p` rejected with, as its status and message. */
  const failure = async (p: Promise<unknown>): Promise<{ status: number; message: string }> => {
    try {
      await p
    } catch (e) {
      if (e instanceof PluginRequestFailed) return { status: e.status, message: e.message }
      throw e
    }
    throw new Error('it did not reject')
  }

  it('asks a running job source and answers what it returned', async () => {
    const { r } = runtime()
    r.start(sourcePlugin('js1'))
    await until(() => expect(r.status('js1')?.status).toBe('running'))
    expect(await r.request('js1', 'jobSource.list', { query: 'login' }, 5_000)).toEqual({ items: [{ id: 'ENG-1', title: 'Fix login' }] })
  }, 90_000)

  it('rejects a function that threw with 502 and its message, and logs it', async () => {
    const { r } = runtime()
    r.start(sourcePlugin('js2'))
    await until(() => expect(r.status('js2')?.status).toBe('running'))
    expect(await failure(r.request('js2', 'jobSource.get', { id: 'boom' }, 5_000))).toEqual({ status: 502, message: 'getItem threw: 401 Unauthorized' })
    await until(() => expect(logOf(r, 'js2')).toContain('[host] jobSource.get failed: getItem threw: 401 Unauthorized'))
  }, 90_000)

  it('rejects past the time limit with 504', async () => {
    const { r } = runtime()
    r.start(sourcePlugin('js3'))
    await until(() => expect(r.status('js3')?.status).toBe('running'))
    expect(await failure(r.request('js3', 'jobSource.context', { id: 'ENG-1' }, 300))).toEqual({ status: 504, message: 'js3 did not answer within 0.3 s' })
  }, 90_000)

  // Review Focus 3: a person listing a source that does not run hears why at once
  it('rejects at once with 503, the status and the reason, when the plugin does not run', async () => {
    const { r } = runtime({ failAfter: 1 })
    expect(await failure(r.request('nobody', 'jobSource.list', {}, 5_000))).toEqual({ status: 503, message: 'nobody is not running' })
    r.start(sourcePlugin('js4', `export default { listItems() {}, getItem() {}, buildJobContext() {}, activate() { throw new Error('no key') } }`))
    await until(() => expect(r.status('js4')?.status).toBe('failed'))
    const t0 = Date.now()
    expect(await failure(r.request('js4', 'jobSource.list', {}, 15_000))).toMatchObject({ status: 503, message: expect.stringMatching(/^js4 is failed: activate threw: no key/) })
    expect(Date.now() - t0).toBeLessThan(1_000)
    r.start(sourcePlugin('js5'))
    await until(() => expect(r.status('js5')?.status).toBe('running'))
    await r.stop('js5')
    expect(await failure(r.request('js5', 'jobSource.list', {}, 5_000))).toEqual({ status: 503, message: 'js5 is stopped' })
  }, 90_000)

  it('fails the start of a job source whose entry lacks one of its functions, saying which', async () => {
    const { r } = runtime({ failAfter: 1 })
    r.start(sourcePlugin('js6', 'export default { listItems() {}, buildJobContext() {} }'))
    await until(() => expect(r.status('js6')).toMatchObject({ status: 'failed', reason: expect.stringContaining('the job-source capability needs getItem in its entry') }))
  }, 90_000)
})
