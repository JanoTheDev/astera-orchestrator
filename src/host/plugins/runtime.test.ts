// The Host's plugin runtime with the real launcher (bundled once) and real plugin processes (plugin runtime design
// P11-P13): calls go to the orch as the plugin, stderr goes to a redacted log, a crash restarts, a crash loop fails,
// and stop runs deactivate or kills the whole tree. In a folder with a space and Hangul (spec §48).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginRuntime, type PluginLaunch, type PluginRuntime, type PluginTimings } from './runtime'
import { bundleLauncher } from '../../pluginHost/testkit'
import { pluginSecrets } from './pluginData'

let dir: string
let launcher: string
let n = 0
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera runtime 플러그인 '))
  launcher = await bundleLauncher(dir)
}, 60_000)
const started: PluginRuntime[] = []
afterEach(async () => {
  for (const r of started.splice(0)) await r.stopAll()
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

type Call = { cmd: string; args: unknown; sessionId: string; from?: { role: string; plugin?: { id: string; granted: ReadonlySet<string> } }; request?: string }

function runtime(timings: Partial<PluginTimings> = {}, extra: { maxLine?: number } = {}) {
  const calls: Call[] = []
  const hostLog: string[] = []
  const profile = path.join(dir, `profile ${++n}`)
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
    timings: { startMs: 10_000, stopGraceMs: 1_000, backoffMs: [50, 50, 50], stableMs: 5_000, failAfter: 3, ...timings },
    ...extra
  })
  started.push(r)
  return { r, calls, hostLog, profile }
}

/** A plugin folder holding `source` as its entry. */
function plugin(name: string, source: string, file = 'index.mjs'): PluginLaunch {
  const d = path.join(dir, 'plugins', name)
  mkdirSync(d, { recursive: true })
  writeFileSync(path.join(d, file), source)
  return { id: name, version: '1.0.0', folder: name, dir: d, entry: path.join(d, file), granted: ['projects.read'], settings: {}, redact: [] }
}

const logOf = (r: PluginRuntime, folder: string): string => (existsSync(r.logFile(folder)) ? readFileSync(r.logFile(folder), 'utf8') : '')
const until = <T>(f: () => T, timeout = 15_000): Promise<T> => vi.waitFor(f, { timeout, interval: 25 })
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
  }, 30_000)

  it('restarts a plugin whose activate throws, marks it failed after the third quick crash, and starts it again on restart', async () => {
    const { r } = runtime()
    const p = plugin('throws', `export default { activate() { throw new Error('no token configured') } }`)
    r.start(p)
    await until(() => expect(r.status('throws')?.status).toBe('failed'))
    expect(r.status('throws')?.reason).toBe(
      'activate threw: no token configured (3 times in a row, each within 5 s of starting); see astera plugins logs --id throws'
    )
    // The log is written a moment after: the writer buffers.
    await until(() => expect(logOf(r, 'throws')).toContain('[host] failed: activate threw: no token configured'))
    expect(logOf(r, 'throws').match(/\[host\] restarting in 0\.05 s/g)).toHaveLength(2)
    writeFileSync(p.entry, `export default { activate(ctx) { ctx.log.info('fixed') } }`)
    r.restart(p)
    await until(() => expect(r.status('throws')?.status).toBe('running'))
  }, 30_000)

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
  }, 30_000)

  it('counts only crashes without a steady run between them', async () => {
    const { r } = runtime({ stableMs: 150 })
    const p = plugin('steady', `export default { activate() { setTimeout(() => process.exit(1), 400) } }`)
    r.start(p)
    await until(() => expect(logOf(r, 'steady').match(/\[host\] exited with code 1/g)?.length ?? 0).toBeGreaterThanOrEqual(4), 20_000)
    expect(r.status('steady')?.status).not.toBe('failed')
  }, 30_000)

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
  }, 30_000)

  it('counts a start that never finishes as a crash', async () => {
    const { r } = runtime({ startMs: 300, failAfter: 1 })
    const p = plugin('hangs', `export default { activate() { return new Promise(() => {}) } }`)
    r.start(p)
    await until(() => expect(r.status('hangs')?.status).toBe('failed'))
    expect(r.status('hangs')?.reason).toMatch(/^it did not finish starting within 0\.3 s/)
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)
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
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)

  it('hides each line of a secret of many lines, and a secret as JSON writes it', async () => {
    const { r } = runtime()
    const key = '-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0\nBAQEFAASCBKcwggSjAgEAAo\n-----END KEY-----'
    const phrase = 'say "open" \\ sesame-77'
    const p = plugin('pem', `export default { activate(ctx) { console.error(ctx.settings.key); console.error(JSON.stringify(ctx.settings)) } }`)
    r.start({ ...p, settings: { key, phrase }, redact: [key, phrase] })
    await until(() => expect(logOf(r, 'pem')).toContain('"phrase"'))
    const log = logOf(r, 'pem')
    for (const leak of ['MIIEvQIBADANBgkqhkiG9w0', 'BAQEFAASCBKcwggSjAgEAAo', 'sesame-77']) expect(log, leak).not.toContain(leak)
  }, 30_000)

  it('hides a secret that holds a shorter one whole', async () => {
    const { r } = runtime()
    const p = plugin('nested', `export default { activate() { console.error('long abcd-long-secret, short abcd') } }`)
    r.start({ ...p, redact: ['abcd', 'abcd-long-secret'] })
    await until(() => expect(logOf(r, 'nested')).toContain('long '))
    expect(logOf(r, 'nested')).toContain('long [redacted], short [redacted]')
  }, 30_000)

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
  }, 30_000)
})
