// The SDK packages as npm publishes them (SDK spec §40): each manifest is one npm takes as it is, public, pointing
// at this repository for provenance and at its guide, and building itself before a publish; each tarball holds the
// package and nothing else; the plugin SDK brings the client its types import.
import { describe, it, expect } from 'vitest'
import { removeFixture } from '../src/core/testFixtures'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage, PACKAGES } from './build-packages.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const manifest = (name) => JSON.parse(readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'))
const GUIDE = { client: 'docs/sdk.md', 'plugin-sdk': 'docs/plugins.md' }
/** A version as numbers, for comparing. */
const parts = (v) => v.split('.').map(Number)
const notAbove = (a, b) => {
  const [x, y] = [parts(a), parts(b)]
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) <= 0
}

describe.each(PACKAGES)('the %s package, as npm publishes it', (name) => {
  const m = manifest(name)

  it('is published, publicly, from this repository', () => {
    expect(m.private).toBeUndefined()
    // No provenance here: npm makes one only in CI, and the first publish is by hand (docs/releasing.md); the
    // workflow asks for it on the command line
    expect(m.publishConfig).toEqual({ access: 'public' })
    // As npm writes it, so a publish auto-corrects nothing, and as provenance checks it against the workflow's repository
    expect(m.repository).toEqual({ type: 'git', url: 'git+https://github.com/parsingk/Astera.git', directory: `packages/${name}` })
    expect(m.homepage).toBe(`https://github.com/parsingk/Astera/blob/main/${GUIDE[name]}`)
    expect(m.bugs).toEqual({ url: 'https://github.com/parsingk/Astera/issues' })
    expect(m.description).not.toMatch(/not published/i)
  })

  it('builds itself before a publish, so a stale or missing dist is never published', () => {
    expect(m.scripts?.prepublishOnly).toBe('node ../../scripts/build-packages.mjs')
    expect(existsSync(path.resolve(root, 'packages', name, '../../scripts/build-packages.mjs'))).toBe(true)
  })

  it('carries a changelog whose latest entry is its version', () => {
    expect(m.files).toContain('CHANGELOG.md')
    const log = readFileSync(path.join(root, 'packages', name, 'CHANGELOG.md'), 'utf8')
    expect(/^## (.+)$/m.exec(log)?.[1]).toBe(m.version)
  })

  it('packs its manifest, readme, licence, changelog and build, every entry point among them, and nothing else', async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'astera-pack '))
    try {
      // A copy built in a folder of its own, so the package's own dist, which other tests build, is not touched
      const pkg = path.join(work, name)
      cpSync(path.join(root, 'packages', name), pkg, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)$/.test(src) })
      cpSync(buildPackage(name, path.join(work, 'build')), path.join(pkg, 'dist'), { recursive: true })
      const r = spawnSync('npm pack --dry-run --json', { cwd: pkg, shell: true, encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stderr).not.toMatch(/auto-corrected|warn/i)
      const files = JSON.parse(r.stdout)[0].files.map((f) => f.path).sort()
      expect(files.filter((f) => !f.startsWith('dist/'))).toEqual(['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json'])
      const entries = [m.main, m.module, m.types, ...Object.values(m.exports['.']).flatMap((half) => Object.values(half))]
      for (const e of entries) expect(files, e).toContain(e.replace(/^\.\//, ''))
      expect(files.filter((f) => /\.test\./.test(f))).toEqual([])
    } finally {
      await removeFixture(work)
    }
  }, 120_000)
})

describe('the plugin SDK and the client', () => {
  // Its declarations import AsteraClient by name: npm installs a peer that is not optional, so a TypeScript author
  // who installs the plugin SDK gets the client's types with it
  it('names the client as a peer npm installs, in a range that takes the client as it is', () => {
    const sdk = manifest('plugin-sdk')
    const client = manifest('client')
    expect(sdk.peerDependenciesMeta?.['@astera-app/client']?.optional).not.toBe(true)
    const range = sdk.peerDependencies['@astera-app/client']
    // Below the next major (final review m3): a client that renames AsteraClient is not taken without a new plugin SDK
    const [, floor, ceiling] = /^>=(\d+\.\d+\.\d+) <(\d+)$/.exec(range) ?? []
    expect(floor, range).toBeDefined()
    expect(notAbove(floor, client.version)).toBe(true)
    expect(Number(ceiling)).toBeGreaterThan(parts(client.version)[0])
  })
})

