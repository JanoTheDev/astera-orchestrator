// The bundled launcher as a real child process (plugin runtime design P2, P13): what a plugin prints cannot break the
// channel, and neither the plugin nor its children see ELECTRON_RUN_AS_NODE. In a folder with a space and Hangul
// (spec §48).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

/** Starts the launcher on a plugin whose entry is `source`, as the Host does: ELECTRON_RUN_AS_NODE set. */
function start(name: string, file: string, source: string) {
  const pluginDir = path.join(dir, name)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(path.join(pluginDir, file), source)
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [launcher], {
    cwd: pluginDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines: Record<string, unknown>[] = []
  const raw: string[] = []
  let stderr = ''
  let held = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c: string) => {
    held += c
    for (let i = held.indexOf('\n'); i >= 0; i = held.indexOf('\n')) {
      const line = held.slice(0, i)
      held = held.slice(i + 1)
      raw.push(line)
      lines.push(JSON.parse(line) as Record<string, unknown>)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c: string) => (stderr += c))
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  const send = (m: Record<string, unknown>): void => void child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const waitFor = async <T>(f: () => T | undefined, what: string): Promise<T> => {
    const until = Date.now() + 20_000
    for (;;) {
      const v = f()
      if (v !== undefined) return v
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}; stderr: ${stderr}`)
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
  return { child, lines, raw, send, waitFor, exited, stderr: () => stderr }
}

describe('the bundled launcher', () => {
  it('keeps the channel clean of what the plugin prints, and logs it instead', async () => {
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
    await p.waitFor(() => p.lines.find((m) => m.id === 1 && 'result' in m), 'the initialize answer')
    // Every line on stdout was JSON-RPC: the two prints went to stderr.
    expect(p.raw.every((l) => l.startsWith('{"jsonrpc":"2.0"'))).toBe(true)
    await p.waitFor(() => (p.stderr().includes('[info] 0 projects') ? true : undefined), 'the plugin log')
    expect(p.stderr()).toContain('hi from console')
    expect(p.stderr()).toContain('raw write')
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
    await p.waitFor(() => p.lines.find((m) => m.id === 1 && 'result' in m), 'the initialize answer')
    await p.waitFor(() => (p.stderr().includes('[info] import') ? true : undefined), 'the plugin log')
    expect(p.stderr()).toContain('[info] import unset, child unset')
    p.child.stdin.end()
    expect(await p.exited).toBe(0)
  }, 30_000)

  it('runs a CommonJS plugin', async () => {
    const p = start('cjs', 'index.cjs', `module.exports = { activate(ctx) { ctx.log.info('cjs ' + ctx.plugin.id) } }`)
    await p.waitFor(() => p.lines.find((m) => m.id === 1 && 'result' in m), 'the initialize answer')
    await p.waitFor(() => (p.stderr().includes('[info] cjs cjs') ? true : undefined), 'the plugin log')
    p.send({ id: 2, method: 'shutdown', params: {} })
    expect(await p.exited).toBe(0)
  }, 30_000)
})
