// The bundled launcher as a real child process (plugin runtime design P2, P9, P13): the channel is the fourth pipe
// (fd 3), so nothing the plugin or its children print can reach it, and neither the plugin nor its children see
// ELECTRON_RUN_AS_NODE. In a folder with a space and Hangul (spec §48).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { bundleLauncher } from './testkit'

let dir: string
let launcher: string
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera launcher 플러그인 '))
  launcher = await bundleLauncher(dir)
}, 60_000)
afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

/** Starts the launcher on a plugin whose entry is `source`, as the Host does: ELECTRON_RUN_AS_NODE set, stdin
 *  ignored, stdout and stderr read as its log, the channel on fd 3. */
function start(name: string, file: string, source: string, extra: Record<string, string> = {}) {
  const pluginDir = path.join(dir, name)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(path.join(pluginDir, file), source)
  for (const [f, text] of Object.entries(extra)) writeFileSync(path.join(pluginDir, f), text)
  const child = spawn(process.execPath, [launcher], {
    cwd: pluginDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe']
  })
  const channel = child.stdio[3] as Duplex
  const lines: Record<string, unknown>[] = []
  const raw: string[] = []
  let log = ''
  let held = ''
  channel.setEncoding('utf8')
  channel.on('data', (c: string) => {
    held += c
    for (let i = held.indexOf('\n'); i >= 0; i = held.indexOf('\n')) {
      const line = held.slice(0, i)
      held = held.slice(i + 1)
      raw.push(line)
      lines.push(JSON.parse(line) as Record<string, unknown>)
    }
  })
  for (const s of [child.stdout, child.stderr]) {
    s?.setEncoding('utf8')
    s?.on('data', (c: string) => (log += c))
  }
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  const send = (m: Record<string, unknown>): void => void channel.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const waitFor = async <T>(f: () => T | undefined, what: string): Promise<T> => {
    const until = Date.now() + 20_000
    for (;;) {
      const v = f()
      if (v !== undefined) return v
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}; log: ${log}`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  send({
    id: 1,
    method: 'initialize',
    params: {
      apiVersion: '1',
      plugin: { id: name, version: '1.0.0', dir: pluginDir, entry: path.join(pluginDir, file), permissions: ['projects.read'] },
      host: { version: '9.9.9', pid: process.pid, startedAt: 'T', features: ['orch', 'requests'] }
    }
  })
  return { child, channel, lines, raw, send, waitFor, exited, log: () => log }
}

const answered = (p: ReturnType<typeof start>, id: number) => p.waitFor(() => p.lines.find((m) => m.id === id && ('result' in m || 'error' in m)), `the answer to ${id}`)

describe('the bundled launcher', () => {
  it('keeps the channel clean of what the plugin prints, and the prints are its log', async () => {
    const p = start(
      'prints',
      'index.mjs',
      `export default {
        async activate(ctx) {
          console.log('hi from console')
          process.stdout.write('raw write\\n')
          const { items } = await ctx.astera.projects.list()
          ctx.log.info(items.length + ' projects')
        }
      }`
    )
    const call = await p.waitFor(() => p.lines.find((m) => m.method === 'call'), 'a call')
    expect(call).toMatchObject({ params: { cmd: 'projects-list', args: {} } })
    p.send({ id: call.id, result: { status: 200, body: [] } })
    expect(await answered(p, 1)).toMatchObject({ result: {} })
    expect(p.raw.every((l) => l.startsWith('{"jsonrpc":"2.0"'))).toBe(true)
    await p.waitFor(() => (p.log().includes('[info] 0 projects') ? true : undefined), 'the plugin log')
    expect(p.log()).toContain('hi from console')
    expect(p.log()).toContain('raw write')
    p.send({ id: 2, method: 'shutdown', params: {} })
    expect(await p.exited).toBe(0)
  }, 30_000)

  // Final review I1: a child that inherits stdout, a write straight to fd 1 and an ended stdout all reach the log.
  it('keeps the channel clean of a child that inherits stdout, a write to fd 1 and an ended stdout', async () => {
    const p = start(
      'inherits',
      'index.mjs',
      `import { spawnSync } from 'node:child_process'
      import { writeSync } from 'node:fs'
      import { fileURLToPath } from 'node:url'
      export default {
        async activate(ctx) {
          spawnSync(process.execPath, [fileURLToPath(new URL('./child.cjs', import.meta.url))], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
          writeSync(1, 'no newline from fd 1')
          process.stdout.end()
          const { items } = await ctx.astera.projects.list()
          ctx.log.info('still talking: ' + items.length)
        }
      }`,
      { 'child.cjs': "process.stdout.write('progress 50%')" }
    )
    const call = await p.waitFor(() => p.lines.find((m) => m.method === 'call'), 'a call')
    p.send({ id: call.id, result: { status: 200, body: [] } })
    expect(await answered(p, 1)).toMatchObject({ result: {} })
    expect(p.raw.every((l) => l.startsWith('{"jsonrpc":"2.0"'))).toBe(true)
    await p.waitFor(() => (p.log().includes('[info] still talking: 0') ? true : undefined), 'the plugin log')
    expect(p.log()).toContain('progress 50%')
    expect(p.log()).toContain('no newline from fd 1')
    p.send({ id: 2, method: 'shutdown', params: {} })
    expect(await p.exited).toBe(0)
  }, 30_000)

  it('hides ELECTRON_RUN_AS_NODE from the plugin and from what it starts', async () => {
    const p = start(
      'env',
      'index.mjs',
      `import { execFileSync } from 'node:child_process'
      const seen = process.env.ELECTRON_RUN_AS_NODE
      export default {
        activate(ctx) {
          const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "unset")'], { encoding: 'utf8' })
          ctx.log.info('import ' + (seen ?? 'unset') + ', child ' + child)
        }
      }`
    )
    await answered(p, 1)
    await p.waitFor(() => (p.log().includes('[info] import') ? true : undefined), 'the plugin log')
    expect(p.log()).toContain('[info] import unset, child unset')
    p.channel.end()
    expect(await p.exited).toBe(0)
  }, 30_000)

  it('runs a CommonJS plugin', async () => {
    const p = start('cjs', 'index.cjs', `module.exports = { activate(ctx) { ctx.log.info('cjs ' + ctx.plugin.id) } }`)
    await answered(p, 1)
    await p.waitFor(() => (p.log().includes('[info] cjs cjs') ? true : undefined), 'the plugin log')
    p.send({ id: 2, method: 'shutdown', params: {} })
    expect(await p.exited).toBe(0)
  }, 30_000)
})
