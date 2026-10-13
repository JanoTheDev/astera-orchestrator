// docs/plugins.md, the plugin author's guide (plugins 2f), is checked against the code it describes: the permissions
// and the SDK methods each opens, the runtime's waits and counts, the redaction floor, the secret and settings limits,
// the capabilities this Astera does not run yet, and the Node a plugin runs on. Its quick start is run as written in
// the real plugin runtime, its TypeScript compiles against the SDKs, its links land, and it is published.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGIN_CAPABILITIES, PLUGIN_PERMISSIONS, PLUGIN_TRUST_WARNING, parseManifest } from './manifest'
import { SETTING_KEYWORDS, SETTING_TYPES, SETTINGS_MAX, parseSettingsSchema } from './settings'
import { PLUGIN_COMMAND_PERMISSIONS } from '../host/pluginGate'
import { PLUGIN_TIMINGS, REDACT_MIN, createPluginRuntime } from '../../host/plugins/runtime'
import { SECRET_NAME_MAX, SECRET_VALUE_MAX } from '../../host/plugins/pluginData'
import { PLUGIN_SERVED_CAPABILITIES } from '../../host/plugins/manager'
import { bundleLauncher } from '../../pluginHost/testkit'
import { createNamespaces } from '../../../packages/client/src/namespaces'
import { typecheckBlocks } from '../../../packages/client/test/typecheck'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8')
const guide = read('docs/plugins.md')

/** One section, from its heading to the next heading of the same or a higher level. */
const section = (doc: string, heading: string): string => {
  const at = doc.indexOf(`\n${heading}\n`)
  if (at < 0) return ''
  const level = heading.match(/^#+/)![0].length
  const rest = doc.slice(at + heading.length + 2)
  const end = rest.search(new RegExp(`\\n#{1,${level}} `))
  return end < 0 ? rest : rest.slice(0, end)
}
const fenced = (doc: string, lang: string): string[] => [...doc.matchAll(new RegExp(`^\`\`\`${lang}\\n([\\s\\S]*?)^\`\`\`$`, 'gm'))].map((m) => m[1])
/** The text outside its fenced blocks, with its lines joined: what a reader takes as a statement. */
const prose = (doc: string): string => doc.replace(/^```[\s\S]*?^```$/gm, '').replace(/\s+/g, ' ')
/** GitHub's heading anchor, for the headings this guide uses. */
const slug = (h: string): string => h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')
const anchors = (doc: string): Set<string> => new Set([...doc.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])))

/** The SDK's typed methods, `namespace.method`. */
const methods = Object.entries(createNamespaces(() => Promise.reject(new Error('no Host')), () => [])).flatMap(([name, api]) =>
  Object.keys(api as object).map((m) => `${name}.${m}`)
)
/** The Host command an SDK method sends: `jobs.list` sends `jobs-list`, with the few the client names otherwise. */
const commandOf = (method: string): string =>
  method.startsWith('events.') ? 'events-poll' : method === 'tasks.create' ? 'tasks-add' : method === 'completion.get' ? 'runs-completion' : method.replace('.', '-')

describe('docs/plugins.md', () => {
  it('says plainly that a plugin is trusted code and its permissions are not a sandbox', () => {
    expect(guide).toContain(`**${PLUGIN_TRUST_WARNING}**`)
    expect(prose(section(guide, '## Plugins are trusted code'))).toMatch(/not a sandbox/)
  })

  it('gives each permission the SDK methods the Host opens with it, and nothing else', () => {
    const table = section(guide, '## Permissions')
    const rows = new Map([...table.matchAll(/^\| `([a-z.-]+)` \| (.+) \|$/gm)].map((m) => [m[1], m[2]]))
    expect([...rows.keys()].sort()).toEqual([...PLUGIN_PERMISSIONS].sort())
    for (const [permission, cell] of rows) {
      const named = [...cell.matchAll(/`([a-z]+\.[A-Za-z]+)`/g)].map((m) => m[1])
      for (const m of named) expect(methods, m).toContain(m)
      const opens = Object.entries(PLUGIN_COMMAND_PERMISSIONS)
        .filter(([, p]) => p === permission)
        .map(([c]) => c)
        .sort()
      expect([...new Set(named.map(commandOf))].sort(), permission).toEqual(opens)
      if (opens.length === 0) expect(cell, permission).toBe('nothing yet')
    }
    // And every SDK method a plugin can call is in the table, in its permission's row
    for (const m of methods) {
      const needs = PLUGIN_COMMAND_PERMISSIONS[commandOf(m)]
      expect(needs, m).toBeDefined()
      expect(rows.get(needs!), m).toContain(`\`${m}\``)
    }
    expect(prose(table)).toContain("call('requests-show'")
    expect(prose(table)).toContain('`PERMISSION_DENIED`')
  })

  it('gives the waits and counts the runtime uses', () => {
    const t = PLUGIN_TIMINGS
    const nth = ['first', 'second', 'third', 'fourth', 'fifth'][t.failAfter - 1]
    const life = prose(section(guide, '## Lifecycle'))
    expect(life).toContain(`within ${t.startMs / 1000} seconds`)
    expect(life).toContain(`${t.stopGraceMs / 1000} seconds to finish`)
    expect(life).toContain(`started again after ${t.backoffMs[0] / 1000}, then ${t.backoffMs[1] / 1000} seconds`)
    expect(life).toContain(`the ${nth} crash without ${t.stableMs / 1000} seconds of steady running`)
  })

  it('says which values its log hides and which it cannot', () => {
    expect(prose(section(guide, '## Logs'))).toContain(`a value shorter than ${REDACT_MIN} characters is not hidden`)
  })

  it('gives the secret limits the store keeps, as the SDK’s own types do', () => {
    const value = `${SECRET_VALUE_MAX.toLocaleString('en-US')} characters`
    const settings = prose(section(guide, '## Settings and secrets'))
    expect(settings).toContain(`at most ${SECRET_NAME_MAX}`)
    expect(settings).toContain(value)
    const sdk = read('packages/plugin-sdk/src/index.ts').replace(/\s+\*?\s*/g, ' ')
    expect(sdk).toContain(`at most ${SECRET_NAME_MAX}`)
    expect(sdk).toContain(value)
  })

  it('lists the settings types and keywords the parser takes, and how many settings it takes', () => {
    const settings = section(guide, '## Settings and secrets')
    for (const t of SETTING_TYPES) expect(settings, t).toContain(`\`${t}\``)
    for (const k of SETTING_KEYWORDS) expect(settings, k).toContain(`\`${k}\``)
    expect(prose(settings)).toContain(`at most ${SETTINGS_MAX} settings`)
  })

  it('gives the other limits the parsers and the Host keep', () => {
    // Through the parsers: each limit holds, and one character past it does not
    const field = (f: Record<string, unknown>, key = 'k'): boolean => parseSettingsSchema({ type: 'object', properties: { [key]: { type: 'string', ...f } } }).ok
    const settings = prose(section(guide, '## Settings and secrets'))
    expect([field({ title: 'x'.repeat(64) }), field({ title: 'x'.repeat(65) })]).toEqual([true, false])
    expect(settings).toContain('`title` (up to 64 characters)')
    expect([field({ description: 'x'.repeat(500) }), field({ description: 'x'.repeat(501) })]).toEqual([true, false])
    expect(settings).toContain('`description` (up to 500)')
    const choices = (n: number): string[] => Array.from({ length: n }, (_, i) => `c${i}`)
    expect([field({ enum: choices(50) }), field({ enum: choices(51) })]).toEqual([true, false])
    expect(settings).toContain('`enum` (up to 50 choices')
    expect([field({}, `k${'x'.repeat(63)}`), field({}, `k${'x'.repeat(64)}`)]).toEqual([true, false])
    expect(settings).toContain('letters, digits or `_`, at most 64 characters')
    const manifest = (extra: Record<string, unknown>) => parseManifest({ name: 'p', version: '1.0.0', astera: { apiVersion: '1', entry: 'i.js' }, ...extra })
    expect([manifest({ displayName: 'x'.repeat(64) }).ok, manifest({ displayName: 'x'.repeat(65) }).ok]).toEqual([true, false])
    const long = manifest({ description: 'x'.repeat(600) })
    expect(long.ok && long.manifest.description?.length).toBe(500)
    const fields = section(guide, '## The manifest')
    expect(fields).toContain('| `displayName` | Optional. What the app shows, up to 64 characters. |')
    expect(fields).toContain('its first 500 characters')
    // Read as text: neither is exported
    const constant = (file: string, name: string): number => {
      const m = new RegExp(`^(?:export )?const ${name} = ([\\d_ *]+)$`, 'm').exec(read(file))
      if (!m) throw new Error(`${file} has no ${name}`)
      return m[1].split('*').reduce((n, f) => n * Number(f.trim().replace(/_/g, '')), 1)
    }
    const entries = constant('src/host/plugins/tarball.ts', 'ENTRIES_MAX').toLocaleString('en-US')
    const mib = constant('src/host/plugins/tarball.ts', 'BYTES_MAX') / 1024 / 1024
    expect(prose(section(guide, '### From npm'))).toContain(`more than ${entries} entries or ${mib} MiB`)
    expect(prose(section(guide, '## Logs'))).toContain(`It is kept to ${constant('src/host/log.ts', 'DEFAULT_MAX_BYTES') / 1024 / 1024} MiB`)
  })

  it('names each kind of plugin this Astera does not run yet', () => {
    const notYet = section(guide, '## Not yet')
    const unserved = PLUGIN_CAPABILITIES.filter((c) => !PLUGIN_SERVED_CAPABILITIES.includes(c))
    expect(unserved.length).toBeGreaterThan(0)
    for (const c of unserved) expect(notYet, c).toContain(`\`${c}\``)
  })

  it('says which Node a plugin runs on, and how to start Node from process.execPath', () => {
    const node = section(guide, '## The Node a plugin runs on')
    const electron = /(\d+)\./.exec(JSON.parse(read('package.json')).devDependencies.electron as string)![1]
    expect(prose(node)).toContain(`Electron ${electron}`)
    // The launcher takes the switch away before a plugin loads, which is why a plugin must give it back to a child
    expect(read('src/pluginHost/index.ts')).toContain('delete process.env.ELECTRON_RUN_AS_NODE')
    expect(fenced(node, 'js').join('\n')).toContain("ELECTRON_RUN_AS_NODE: '1'")
  })

  it('every TypeScript block compiles against the plugin SDK and the client', () => {
    const blocks = fenced(guide, 'ts')
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(typecheckBlocks(blocks)).toBe('')
  }, 60_000)

  it('every link lands on a file, and an anchor on a heading there', () => {
    const links = [...guide.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/.test(l))
    expect(links.length).toBeGreaterThan(5)
    for (const l of links) {
      const [file, anchor] = l.split('#')
      const target = file === '' ? path.join(root, 'docs', 'plugins.md') : path.resolve(root, 'docs', file)
      expect(existsSync(target), l).toBe(true)
      if (anchor !== undefined) expect(anchors(readFileSync(target, 'utf8')).has(anchor), l).toBe(true)
    }
  })

  it('links the sample, and the sample links back', () => {
    expect(guide).toContain('](../examples/plugins/webhook-notifier)')
    expect(read('examples/plugins/webhook-notifier/README.md')).toContain('docs/plugins.md)')
  })

  it('is reached from the CLI and SDK guides, the README and the plugin SDK’s README, and the SDK no longer lists plugins as missing', () => {
    expect(read('docs/cli.md')).toContain('](plugins.md)')
    expect(read('docs/sdk.md')).toContain('](plugins.md)')
    expect(section(read('docs/sdk.md'), '## Not yet')).not.toMatch(/Plugins/)
    expect(read('README.md')).toContain('](docs/plugins.md)')
    expect(read('packages/plugin-sdk/README.md')).toContain('docs/plugins.md')
  })

  it('is published: docs/ is a gitignore whitelist, and the guide is on it', () => {
    // git check-ignore exits 1 when nothing ignores the path
    let status: unknown = 0
    try {
      execFileSync('git', ['check-ignore', '-q', 'docs/plugins.md'], { cwd: root, stdio: 'ignore' })
    } catch (e) {
      status = (e as { status?: unknown }).status
    }
    expect(status).toBe(1)
  })
})

describe('the quick start, followed as written', () => {
  let work: string
  let launcher: string
  beforeAll(async () => {
    work = mkdtempSync(path.join(os.tmpdir(), 'astera quick start '))
    launcher = await bundleLauncher(work)
  }, 60_000)
  afterAll(() => {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 })
  })

  it('is a plugin Astera installs and runs, and its log says what the guide says it will', async () => {
    const start = section(guide, '## Quick start')
    const [pkgText] = fenced(start, 'json')
    const [code] = fenced(start, 'js')
    const parsed = parseManifest(JSON.parse(pkgText))
    if (!parsed.ok) throw new Error(parsed.problems.join('; '))
    const m = parsed.manifest
    for (const command of fenced(start, 'sh').join('\n').split('\n').filter((l) => l.startsWith('astera plugins ') && l.includes('--id')))
      expect(command, command).toContain(`--id ${m.id}`)
    const dir = path.join(work, m.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), pkgText)
    writeFileSync(path.join(dir, m.entry), code)

    const r = createPluginRuntime({
      profileDir: path.join(work, 'profile'),
      exec: process.execPath,
      launcher,
      env: process.env,
      host: () => ({ version: '9.9.9', pid: process.pid, startedAt: 'T', features: ['orch', 'requests', 'events'] }),
      orch: {
        call: (async (a: { cmd: string }) =>
          a.cmd === 'projects-list' ? { status: 200, body: [{ id: 'p1', path: '/a' }, { id: 'p2', path: '/b' }] } : { status: 404, body: { error: `no ${a.cmd}` } }) as never
      },
      log: () => {}
    })
    try {
      r.start({ id: m.id, version: m.version, folder: m.id, dir, entry: path.join(dir, m.entry), granted: m.permissions, settings: {}, redact: [] })
      // The log lines the guide shows, without their times and the process id
      const shown = fenced(start, 'text')
        .join('\n')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => l.replace(/^\S+ /, '').replace(/pid \d+/, 'pid '))
      expect(shown.length).toBeGreaterThanOrEqual(2)
      await expect
        .poll(() => (existsSync(r.logFile(m.id)) ? readFileSync(r.logFile(m.id), 'utf8').replace(/pid \d+/g, 'pid ') : ''), { timeout: 20_000, interval: 50 })
        .toSatisfy((log: string) => shown.every((l) => log.includes(l)))
    } finally {
      await r.stopAll()
    }
  }, 40_000)
})
