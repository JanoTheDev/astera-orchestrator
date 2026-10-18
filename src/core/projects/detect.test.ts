// W7-B: what an existing folder is for `projects-add` (inspectFolder, on real git in a temp dir), the test command it
// proposes per ecosystem, and the run-configs list `projects-set --test-command` stores.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectFolder, proposeTestCommand, TEST_CONFIG_ID, withTestCommand } from './detect'
import { git } from '../worktrees/git'
import type { RunConfig } from '../run/config'

const withTest = JSON.stringify({ scripts: { test: 'vitest run' } })

describe('proposeTestCommand', () => {
  it('runs the package.json test script with the lockfile’s package manager', () => {
    expect(proposeTestCommand(['package.json', 'package-lock.json'], { packageJson: withTest })).toBe('npm test')
    expect(proposeTestCommand(['package.json'], { packageJson: withTest })).toBe('npm test')
    expect(proposeTestCommand(['package.json', 'pnpm-lock.yaml'], { packageJson: withTest })).toBe('pnpm test')
    expect(proposeTestCommand(['package.json', 'yarn.lock'], { packageJson: withTest })).toBe('yarn test')
    expect(proposeTestCommand(['package.json', 'bun.lockb'], { packageJson: withTest })).toBe('bun run test')
  })

  it('falls through a package.json with no test script, or one that does not parse', () => {
    const files = ['package.json', 'Cargo.toml']
    expect(proposeTestCommand(files, { packageJson: JSON.stringify({ scripts: { build: 'tsc' } }) })).toBe('cargo test')
    expect(proposeTestCommand(files, { packageJson: JSON.stringify({ scripts: { test: 1 } }) })).toBe('cargo test')
    expect(proposeTestCommand(files, { packageJson: '{not json' })).toBe('cargo test')
    expect(proposeTestCommand(files, { packageJson: 'null' })).toBe('cargo test')
  })

  it('takes a Makefile test target, and not a target merely named like it', () => {
    expect(proposeTestCommand(['Makefile'], { makefile: 'build:\n\tcc x.c\ntest: build\n\t./x\n' })).toBe('make test')
    expect(proposeTestCommand(['Makefile'], { makefile: 'tests:\n\t./x\n' })).toBeNull()
    expect(proposeTestCommand(['Makefile', 'go.mod'], { makefile: 'all:\n' })).toBe('go test ./...')
  })

  it('reads Cargo.toml, go.mod and pyproject.toml in that order', () => {
    expect(proposeTestCommand(['Cargo.toml', 'go.mod', 'pyproject.toml'], {})).toBe('cargo test')
    expect(proposeTestCommand(['go.mod', 'pyproject.toml'], {})).toBe('go test ./...')
    expect(proposeTestCommand(['pyproject.toml'], {})).toBe('pytest')
  })

  it('answers null when nothing there names one', () => {
    expect(proposeTestCommand([], {})).toBeNull()
    expect(proposeTestCommand(['README.md', 'src'], { packageJson: null, makefile: null })).toBeNull()
  })
})

describe('inspectFolder', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-detect-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })
  const run = async (cwd: string, args: string[]): Promise<void> => {
    const r = await git(args, { cwd })
    if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }

  it('answers null for a folder that is not in a git repository', async () => {
    expect(await inspectFolder(dir)).toBeNull()
  })

  it('reports a repository with no commit, its branch from HEAD, and a proposal', async () => {
    await run(dir, ['init', '-b', 'trunk'])
    await fs.writeFile(path.join(dir, 'go.mod'), 'module x\n')
    expect(await inspectFolder(dir)).toEqual({ root: path.resolve(dir), hasCommit: false, defaultBranch: 'trunk', proposedTest: 'go test ./...' })
  })

  it('reports a committed repository by its top level from a subfolder', async () => {
    await run(dir, ['init', '-b', 'main'])
    await fs.writeFile(path.join(dir, 'package.json'), withTest)
    await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), '')
    await fs.mkdir(path.join(dir, 'src'))
    await run(dir, ['add', '-A'])
    await run(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'one'])
    const report = await inspectFolder(path.join(dir, 'src'))
    // the temp dir may sit behind a symlink (macOS /var): compare with what git itself reports
    const top = (await git(['rev-parse', '--show-toplevel'], { cwd: dir })).stdout
    expect(report).toEqual({ root: path.resolve(top), hasCommit: true, defaultBranch: 'main', proposedTest: 'pnpm test' })
  })
})

describe('withTestCommand', () => {
  const other: RunConfig = { id: 'dev', name: 'Dev', type: 'shell', command: 'npm run dev' } as RunConfig
  it('adds the test configuration beside the others', () => {
    expect(withTestCommand([other], 'npm test')).toEqual({
      configs: [other, { id: TEST_CONFIG_ID, name: 'Test', type: 'shell', command: 'npm test' }],
      id: TEST_CONFIG_ID
    })
  })

  it('replaces the one it saved before, keeping one', () => {
    const first = withTestCommand([other], 'npm test').configs
    const second = withTestCommand(first, 'pnpm test')
    expect(second.configs.filter((c) => c.id === TEST_CONFIG_ID)).toEqual([{ id: TEST_CONFIG_ID, name: 'Test', type: 'shell', command: 'pnpm test' }])
    expect(second.configs).toHaveLength(2)
  })

  it('removes it on null and answers no id', () => {
    const saved = withTestCommand([other], 'npm test').configs
    expect(withTestCommand(saved, null)).toEqual({ configs: [other], id: null })
  })
})
