// docs/sdk.md and this package's README are checked against the code they describe: every typed method, event type,
// local error code and default they name is the package's, every TypeScript block compiles against it, every link
// lands, and the guide is not left out of git by docs/'s whitelist.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS } from './client.js'
import { DEFAULT_WAIT_TIMEOUT_MS } from './deadlines.js'
import { ERROR_CODES, REMOTE_ERROR_CODES } from './errors.js'
import { EVENTS_RETRY_MS } from './events.js'
import { EVENT_TYPES } from './fields.js'
import { createNamespaces } from './namespaces.js'
import { typecheckBlocks } from '../test/typecheck.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8')
const guide = read('docs/sdk.md')
const readme = read('packages/client/README.md')

/** One section, from its heading to the next heading of the same or a higher level. */
const section = (doc: string, heading: string): string => {
  const at = doc.indexOf(`\n${heading}\n`)
  if (at < 0) return ''
  const level = heading.match(/^#+/)![0].length
  const rest = doc.slice(at + heading.length + 2)
  const end = rest.search(new RegExp(`\\n#{1,${level}} `))
  return end < 0 ? rest : rest.slice(0, end)
}
const blocks = (doc: string): string[] => [...doc.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((m) => m[1])
/** GitHub's heading anchor, for the headings these docs use. */
const slug = (h: string): string => h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')
const anchors = (doc: string): Set<string> => new Set([...doc.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])))

describe('docs/sdk.md', () => {
  it('names every typed method', () => {
    const ns = createNamespaces(() => Promise.reject(new Error('no Host')), () => [])
    const methods = Object.entries(ns).flatMap(([name, api]) => Object.keys(api as object).map((m) => `${name}.${m}`))
    expect(methods.length).toBeGreaterThan(20)
    for (const m of methods) expect(guide, m).toContain(m)
    for (const m of ['call(', 'close()', 'hasFeature(', 'host.features']) expect(guide, m).toContain(m)
  })

  it('names every event type in its Events section, and the README does too', () => {
    const events = section(guide, '## Events')
    for (const t of EVENT_TYPES) {
      expect(events, t).toContain(`\`${t}\``)
      expect(readme, t).toContain(`\`${t}\``)
    }
  })

  it('names every local error code in its Errors section', () => {
    const errors = section(guide, '## Errors')
    for (const c of ERROR_CODES.filter((c) => !(REMOTE_ERROR_CODES as readonly string[]).includes(c))) expect(errors, c).toContain(`\`${c}\``)
  })

  it('gives the deadlines and waits the code uses', () => {
    expect(guide).toContain(`${DEFAULT_CONNECT_TIMEOUT_MS / 1000} s`)
    expect(guide).toContain(`${DEFAULT_CALL_TIMEOUT_MS / 1000} s`)
    expect(guide).toContain(`${DEFAULT_WAIT_TIMEOUT_MS / 3_600_000} hour`)
    expect(guide).toContain(`${EVENTS_RETRY_MS[0]} ms, ${EVENTS_RETRY_MS[1] / 1000} s, then every ${EVENTS_RETRY_MS[2] / 1000} s`)
  })

  it('says what the spec asks it to', () => {
    expect(guide).toContain("Build integrations and automation on top of Astera's durable Host with the official TypeScript client.")
    expect(guide).toMatch(/[Cc]ancelling a call is not cancelling a Run/)
    expect(guide).toMatch(/npm run build:packages/)
    expect(guide).toMatch(/not on npm yet/)
    expect(guide).toMatch(/requestId/)
    expect(guide).toMatch(/\{ items, nextCursor \}/)
  })

  it('every TypeScript block of the guide and the README compiles against the package', () => {
    const all = [...blocks(guide), ...blocks(readme)]
    expect(blocks(guide).length).toBeGreaterThanOrEqual(8)
    expect(typecheckBlocks(all)).toBe('')
  }, 60_000)

  it('every link lands on a file, and an anchor on a heading there', () => {
    const links = [...guide.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/.test(l))
    expect(links.length).toBeGreaterThan(5)
    for (const l of links) {
      const [file, anchor] = l.split('#')
      const target = file === '' ? path.join(root, 'docs', 'sdk.md') : path.resolve(root, 'docs', file)
      expect(existsSync(target), l).toBe(true)
      if (anchor !== undefined) expect(anchors(readFileSync(target, 'utf8')).has(anchor), l).toBe(true)
    }
  })

  it('links every example, and the examples README lists each', () => {
    const examples = readdirSync(path.join(root, 'examples', 'sdk')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(examples.length).toBe(4)
    const list = read('examples/sdk/README.md')
    for (const f of examples) {
      expect(guide, f).toContain(`](../examples/sdk/${f})`)
      expect(list, f).toContain(`](${f})`)
    }
  })

  it('is reached from the CLI and MCP guides and from the package README', () => {
    expect(read('docs/cli.md')).toContain('](sdk.md)')
    expect(read('docs/mcp.md')).toContain('](sdk.md)')
    expect(readme).toContain('docs/sdk.md')
  })

  it('is published: docs/ is a gitignore whitelist, and the guide is on it', () => {
    // git check-ignore exits 1 when nothing ignores the path
    let status: unknown = 0
    try {
      execFileSync('git', ['check-ignore', '-q', 'docs/sdk.md'], { cwd: root, stdio: 'ignore' })
    } catch (e) {
      status = (e as { status?: unknown }).status
    }
    expect(status).toBe(1)
  })
})
