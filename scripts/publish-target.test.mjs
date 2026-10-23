// Publishing the SDK packages (docs/releasing.md): a tag names the package and its version, and the workflow that
// publishes it does so with npm's trusted publishing, after building and testing it, and never on an app tag.
import { describe, it, expect } from 'vitest'
import { removeFixture } from '../src/core/testFixtures'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGES } from './build-packages.mjs'
import { dryRunTarget, publishTarget } from './publish-target.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (f) => readFileSync(path.join(root, f), 'utf8')
const version = (dir) => JSON.parse(read(`packages/${dir}/package.json`)).version
const script = path.join(here, 'publish-target.mjs')
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

describe('publishTarget', () => {
  it('maps a tag to its package at the version its package.json holds', () => {
    expect(publishTarget(`client-v${version('client')}`)).toEqual({ dir: 'client', name: '@astera-app/client', version: version('client') })
    expect(publishTarget(`plugin-sdk-v${version('plugin-sdk')}`)).toEqual({ dir: 'plugin-sdk', name: '@astera-app/plugin-sdk', version: version('plugin-sdk') })
  })

  it('refuses a tag whose version is not the package’s, saying which tag to push', () => {
    const at = () => ({ name: '@astera-app/client', version: '0.2.0' })
    expect(() => publishTarget('client-v0.1.9', at)).toThrow('client-v0.1.9 does not match packages/client/package.json (0.2.0): push client-v0.2.0')
  })

  it('refuses an app tag and a tag that names no package', () => {
    for (const tag of ['v1.4.13', 'jira-v1.0.0', 'client-1.0.0', 'client-v1.0', 'client-v1.0.0-beta.1'])
      expect(() => publishTarget(tag), tag).toThrow(`${tag} names no package: a publish tag is client-vX.Y.Z or plugin-sdk-vX.Y.Z`)
  })

  it('takes a package by its folder for a dry run, at its version', () => {
    expect(dryRunTarget('plugin-sdk')).toEqual({ dir: 'plugin-sdk', name: '@astera-app/plugin-sdk', version: version('plugin-sdk') })
    expect(() => dryRunTarget('nope')).toThrow('nope is not a package: client or plugin-sdk')
  })

  it('writes the workflow’s outputs as a script, and nothing but its reason when it refuses', () => {
    const ok = run('--tag', `client-v${version('client')}`)
    expect(ok.status, ok.stderr).toBe(0)
    expect(ok.stdout).toBe(`dir=client\nname=@astera-app/client\nversion=${version('client')}\n`)
    expect(run('--package', 'plugin-sdk').stdout).toBe(`dir=plugin-sdk\nname=@astera-app/plugin-sdk\nversion=${version('plugin-sdk')}\n`)
    const refused = run('--tag', 'v1.4.13')
    expect(refused.status).toBe(1)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('v1.4.13 names no package')
    expect(run().status).toBe(1)
  })

  // Final review C1: the workflow runs it before `npm ci`, on a checkout with nothing installed, where a module that
  // looked for typescript when it was imported crashed every run
  it('runs on a checkout with nothing installed', async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'astera-publish target '))
    try {
      mkdirSync(path.join(work, 'scripts'))
      for (const f of readdirSync(here).filter((f) => f.endsWith('.mjs') && !f.includes('.test.')))
        copyFileSync(path.join(here, f), path.join(work, 'scripts', f))
      for (const p of PACKAGES) {
        mkdirSync(path.join(work, 'packages', p), { recursive: true })
        copyFileSync(path.join(root, 'packages', p, 'package.json'), path.join(work, 'packages', p, 'package.json'))
      }
      const r = spawnSync(process.execPath, [path.join(work, 'scripts', 'publish-target.mjs'), '--tag', `client-v${version('client')}`], { cwd: work, encoding: 'utf8' })
      expect(r.stderr).toBe('')
      expect(r.status).toBe(0)
      expect(r.stdout).toBe(`dir=client\nname=@astera-app/client\nversion=${version('client')}\n`)
    } finally {
      await removeFixture(work)
    }
  })
})

describe('.github/workflows/publish-packages.yml', () => {
  const wf = read('.github/workflows/publish-packages.yml')
  /** The workflow without its comments, which name commands they do not run. */
  const code = wf.replace(/^\s*#.*$/gm, '')
  /** The lines of one step, from its `- ` to the next step's. */
  const step = (marker) => {
    const at = wf.indexOf(marker)
    expect(at, marker).toBeGreaterThan(0)
    const start = wf.lastIndexOf('\n      - ', at)
    const end = wf.indexOf('\n      - ', at)
    return wf.slice(start, end < 0 ? undefined : end)
  }

  it('runs on a tag of each package, and by hand for one of them', () => {
    const tags = /^ {4}tags: \[(.+)\]$/m.exec(wf)?.[1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''))
    expect(tags).toEqual(PACKAGES.map((p) => `${p}-v[0-9]+.[0-9]+.[0-9]+`))
    expect(wf).toMatch(/^ {2}workflow_dispatch:$/m)
    expect(/^ {8}options: \[(.+)\]$/m.exec(wf)?.[1].split(',').map((o) => o.trim())).toEqual(PACKAGES)
  })

  it('publishes with npm’s trusted publishing: an OIDC token, and no npm token anywhere', () => {
    expect(wf).toMatch(/^ {2}id-token: write\b/m)
    expect(wf).toMatch(/^ {2}contents: read\b/m)
    expect(wf).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/)
    // npm takes trusted publishing from 11.5.1
    const npm = /npm install -g npm@(\d+)\.(\d+)\.(\d+)/.exec(wf)
    expect(npm).not.toBeNull()
    const [major, minor, patch] = npm.slice(1).map(Number)
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(11 * 1e6 + 5 * 1e3 + 1)
    // Its comment says it is the npm Astera fetches for its own plugin installs (final review m4)
    expect(`${major}.${minor}.${patch}`).toBe(/^ {2}version: '([^']+)'/m.exec(read('src/host/plugins/ownNpm.ts'))?.[1])
  })

  it('checks the tag before anything else, then builds and tests the package, and only then publishes it', () => {
    const order = ['scripts/publish-target.mjs --tag "$GITHUB_REF_NAME"', 'npm ci --ignore-scripts', 'npm run build:packages', 'npx vitest run', 'npm publish']
    const at = order.map((s) => code.indexOf(s))
    for (const [i, s] of order.entries()) expect(at[i], s).toBeGreaterThan(0)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(step('npx vitest run')).toContain('packages/${{ steps.target.outputs.dir }}')
    expect(step('npx vitest run')).toContain('scripts/publish-packages.test.mjs')
  })

  it('publishes with provenance from the package’s folder on a tag, and only dry-runs by hand', () => {
    const publish = step('run: npm publish --provenance\n')
    expect(publish).toContain("if: github.event_name == 'push'")
    expect(publish).toContain('working-directory: packages/${{ steps.target.outputs.dir }}')
    const dry = step('npm publish --provenance --dry-run')
    expect(dry).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(dry).toContain('working-directory: packages/${{ steps.target.outputs.dir }}')
    expect(code.match(/npm publish/g)).toHaveLength(2)
    // Found on the first dry run from main: npm refuses even a dry run of a version it holds, which between releases
    // is the one package.json holds, so the try stops at the tarball there and says so, rather than ending red
    expect(dry).toContain('npm view "$NAME@$VERSION" version')
    expect(dry).toContain('npm pack --dry-run')
    expect(dry).toContain('NAME: ${{ steps.target.outputs.name }}')
    expect(dry).toContain('VERSION: ${{ steps.target.outputs.version }}')
    expect(dry).not.toMatch(/run:.*\$\{\{/)
    // The package chosen by hand reaches the shell through the environment, not pasted into the script
    expect(step('scripts/publish-target.mjs --package')).toContain('PACKAGE: ${{ inputs.package }}')
    expect(wf).not.toMatch(/run:.*\$\{\{ inputs\./)
  })

  it('is apart from the app’s release, whose tag no package tag matches', () => {
    // The app releases stable tags and betas; no package tag (`client-vX.Y.Z`) may match either pattern
    const patterns = /^ {4}tags: \[(.+)\]$/m.exec(read('.github/workflows/release.yml'))?.[1].split(', ').map((x) => x.slice(1, -1))
    expect(patterns).toEqual(['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+'])
    // Tag patterns are anchored globs: one starting with `v` cannot match a tag starting with a package name
    for (const pat of patterns ?? []) expect(pat.startsWith('v['), pat).toBe(true)
  })
})

describe('docs/releasing.md', () => {
  const doc = read('docs/releasing.md')
  const at = doc.indexOf('\n## Publishing the SDK packages\n')
  const rest = at < 0 ? '' : doc.slice(at + 1)
  const s = rest.slice(0, rest.indexOf('\n## ', 3) < 0 ? undefined : rest.indexOf('\n## ', 3))

  it('says how a package is published: its tag, the workflow that takes it, and a dry run', () => {
    for (const p of PACKAGES) expect(s, p).toContain(`\`${p}-vX.Y.Z\``)
    expect(s).toContain('[publish-packages.yml](../.github/workflows/publish-packages.yml)')
    expect(existsSync(path.join(root, '.github', 'workflows', 'publish-packages.yml'))).toBe(true)
    expect(s).toContain('`npm publish --dry-run`')
    expect(s).toContain('CHANGELOG.md')
    // Final review m4: the changelog test takes the heading as the bare version
    expect(s).toContain('`## X.Y.Z`')
    // Final review m1: GitHub offers Run workflow only for a workflow on the default branch
    expect(s).toContain('default branch')
    // The first dry run from main: a version npm holds is tried as far as the tarball, a bumped one on a branch in full
    expect(s).toContain('`npm pack --dry-run`')
    expect(s).toContain('gh workflow run publish-packages.yml --ref')
  })

  // Final review I1: client.test.ts holds CLIENT_VERSION to the package's version, and runs before the publish
  it('says to bump the client’s CLIENT_VERSION with its package.json', () => {
    expect(read('packages/client/src/client.ts')).toMatch(/^export const CLIENT_VERSION = '/m)
    expect(s).toContain('`CLIENT_VERSION` in `packages/client/src/client.ts`')
  })

  // Declined by the final review, ruled a finding: `--tags` pushes every local tag, a package tag waiting to be pushed
  // too, which would publish it with the app; and more than three tags in one push start no workflow at all
  it('pushes the app’s tag by name, never every tag', () => {
    expect(doc).not.toMatch(/git push[^\n`]*--tags/)
    expect(doc).toContain('git push origin v1.0.1')
  })

  it('says how the first version of each was published by hand, and what npm’s trusted publisher is set to', () => {
    for (const p of PACKAGES) expect(s, p).toMatch(new RegExp(`cd (?:packages|\\.\\.)/${p}\\s*\\n\\s*npm publish`))
    expect(s).toContain('npm login')
    const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)\.git$/.exec(JSON.parse(read('packages/client/package.json')).repository.url)
    expect(s).toContain(`| Organization or user | \`${owner}\` |`)
    expect(s).toContain(`| Repository | \`${repo}\` |`)
    expect(s).toContain('| Workflow filename | `publish-packages.yml` |')
    expect(s).toContain('| Environment | none |')
    // Final review m4: an owner still publishes by hand with two-factor authentication
    expect(s).toContain('no token can publish')
    expect(s).not.toContain('nothing else can publish')
    // npm 11 confirms a publish in the browser unless the account asks for codes
    expect(s).toContain('in the browser or with a code')
  })
})
