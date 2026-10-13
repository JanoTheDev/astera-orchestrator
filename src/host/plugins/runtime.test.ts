// The Host's plugin runtime with the real launcher (bundled once) and real plugin processes (plugin runtime design
// P11-P13): calls go to the orch as the plugin, stderr goes to a redacted log, a crash restarts, a crash loop fails,
// and stop runs deactivate or kills the whole tree. In a folder with a space and Hangul (spec §48).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginRuntime, type PluginLaunch, type PluginRuntime, type PluginTimings } from './runtime'
import { bundleLauncher } from '../../pluginHost/testkit'

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
  const r = createPluginRuntime({
    profileDir: path.join(dir, `profile ${++n}`),
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
    log: () => {},
    timings: { startMs: 10_000, stopGraceMs: 1_000, backoffMs: [50, 50, 50], stableMs: 5_000, failAfter: 3, ...timings },
    ...extra
  })
  started.push(r)
  return { r, calls }
}

/** A plugin folder holding `source` as its entry. */
function plugin(name: string, source: string, file = 'index.mjs'): PluginLaunch {
  const d = path.join(dir, 'plugins', name)
  mkdirSync(d, { recursive: true })
  writeFileSync(path.join(d, file), source)
  return { id: name, version: '1.0.0', folder: name, dir: d, entry: path.join(d, file), granted: ['projects.read'] }
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
      `import net from 'node:net'
      export default {
        activate() {
          const channel = new net.Socket({ fd: 3, readable: false, writable: true })
          channel.write('x'.repeat(5000))
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
