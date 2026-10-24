// W7-B: a brand-new project folder (`projects-create`): refusals, `git init -b main`, the two files, the initial
// commit a worktree forks from, and the `gh repo create` call. Real git in a temp dir, with no global identity, so the
// commit has to stand on mergeIdentityArgs' fallback the way it would on a fresh machine.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeMdFor, createProjectFolder, githubCreate, gitignoreFor, hasOriginRemote, initGitFolder } from './create'
import { git } from '../worktrees/git'
import type { GhRunner } from '../github/gh'

const IDENTITY_ENV = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']
const saved: Record<string, string | undefined> = {}
let home: string
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-create-home-'))
  for (const k of IDENTITY_ENV) saved[k] = process.env[k]
  for (const k of IDENTITY_ENV) delete process.env[k]
  // An empty global config and no system one: this machine's own user.name/user.email must not make the test pass
  const globalConfig = path.join(home, 'gitconfig')
  await fs.writeFile(globalConfig, '')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(async () => {
  for (const k of IDENTITY_ENV) if (saved[k] === undefined) delete process.env[k]
  else process.env[k] = saved[k]
  await fs.rm(home, { recursive: true, force: true })
})

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-create-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const gitOut = async (cwd: string, args: string[]): Promise<string> => {
  const r = await git(args, { cwd })
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

describe('createProjectFolder', () => {
  it('makes a repository on main with .gitignore, CLAUDE.md and an initial commit a worktree forks from', async () => {
    const root = await createProjectFolder({ name: 'shop', parent: dir, describe: 'A TypeScript and React web shop' })
    expect(root).toBe(path.join(dir, 'shop'))
    expect((await fs.stat(path.join(root, '.git'))).isDirectory()).toBe(true)
    expect(await gitOut(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect(await gitOut(root, ['log', '--format=%s'])).toBe('Initial commit')
    expect(await gitOut(root, ['ls-files'])).toBe('.gitignore\nCLAUDE.md')
    expect(await gitOut(root, ['status', '--porcelain'])).toBe('')
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toContain('node_modules/')
    const md = await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')
    expect(md).toContain('# shop')
    expect(md).toContain('Follow the GitHub rules below')

    const wt = path.join(dir, 'wt-x')
    await gitOut(root, ['worktree', 'add', '-b', 'x', wt, 'main'])
    expect(await fs.readFile(path.join(wt, 'CLAUDE.md'), 'utf8')).toBe(md)
  })

  it('makes the commit with no describe', async () => {
    const root = await createProjectFolder({ name: 'blank', parent: dir })
    expect(await gitOut(root, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')).toContain('A new project.')
  })

  it('refuses a folder that already exists and leaves it untouched', async () => {
    const existing = path.join(dir, 'taken')
    await fs.mkdir(existing)
    await fs.writeFile(path.join(existing, 'mine.txt'), 'keep')
    await expect(createProjectFolder({ name: 'taken', parent: dir })).rejects.toThrow(/already exists/)
    expect(await fs.readdir(existing)).toEqual(['mine.txt'])
  })

  it('refuses a bad name, a relative parent and a parent that is not there, making nothing', async () => {
    for (const name of ['', 'a/b', '..', '-rf', 'x\0y'])
      await expect(createProjectFolder({ name, parent: dir })).rejects.toThrow(/not a folder name/)
    await expect(createProjectFolder({ name: 'ok', parent: 'relative/dir' })).rejects.toThrow(/absolute/)
    await expect(createProjectFolder({ name: 'ok', parent: path.join(dir, 'nope') })).rejects.toThrow(/not a folder/)
    expect(await fs.readdir(dir)).toEqual([])
  })
})

describe('initGitFolder', () => {
  it('makes a plain folder a repository on main and commits what is there, adding a .gitignore', async () => {
    const root = path.join(dir, 'plain')
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'mine')
    await initGitFolder(root)
    expect((await git(['symbolic-ref', '--short', 'HEAD'], { cwd: root })).stdout).toBe('main')
    expect((await git(['ls-files'], { cwd: root })).stdout.split('\n').sort()).toEqual(['.gitignore', 'a.txt'])
  })

  it('keeps a .gitignore that is already there', async () => {
    const root = path.join(dir, 'ignored')
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, '.gitignore'), 'secret\n')
    await initGitFolder(root)
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('secret\n')
  })
})

describe('gitignoreFor', () => {
  it('always leaves out .env and logs, and adds each named stack once', () => {
    const plain = gitignoreFor('')
    expect(plain.split('\n')).toEqual(expect.arrayContaining(['.env', '!.env.example', '*.log']))
    expect(plain).not.toContain('node_modules/')
    expect(plain.endsWith('\n')).toBe(true)
    const both = gitignoreFor('Rust CLI with a Java backend')
    expect(both.split('\n').filter((l) => l === 'target/')).toHaveLength(1)
    expect(gitignoreFor('a python api')).toContain('__pycache__/')
  })

  it('matches whole words only', () => {
    // "going" and "pygmy" hold go and py but name neither
    expect(gitignoreFor('going to pygmy island')).toBe(gitignoreFor(''))
  })
})

describe('claudeMdFor', () => {
  it('names the project, its description, its stacks and the GitHub rules', () => {
    const md = claudeMdFor('api', '  A Go service  ')
    expect(md.startsWith('# api\n\nA Go service\n')).toBe(true)
    expect(md).toContain('- Go')
    expect(md).toContain('## GitHub rules')
    expect(md).toContain('Follow the GitHub rules below')
  })

  it('asks for a stack when the description names none', () => {
    expect(claudeMdFor('x', 'something')).toContain('Not chosen yet')
  })
})

describe('githubCreate', () => {
  it('runs gh repo create in the folder and answers the URL line', async () => {
    const calls: { args: string[]; cwd: string }[] = []
    const gh: GhRunner = async (args, cwd) => {
      calls.push({ args, cwd })
      return { ok: true, stdout: 'Created repository me/shop\nhttps://github.com/me/shop\n', stderr: '' } as never
    }
    expect(await githubCreate(gh, '/tmp/shop', 'shop', 'private')).toBe('https://github.com/me/shop')
    expect(calls).toEqual([{ args: ['repo', 'create', 'shop', '--private', '--source', '.', '--push'], cwd: '/tmp/shop' }])
    await githubCreate(gh, '/tmp/shop', 'shop', 'public')
    expect(calls[1].args[3]).toBe('--public')
  })

  it("throws gh's error", async () => {
    const gh: GhRunner = async () => ({ ok: false, stdout: '', stderr: 'name already exists' }) as never
    await expect(githubCreate(gh, '/tmp/shop', 'shop', 'private')).rejects.toThrow('gh repo create failed: name already exists')
  })
})

describe('hasOriginRemote', () => {
  it('is true for a repository with an origin remote, false for one without', async () => {
    const root = await createProjectFolder({ name: 'shop', parent: dir })
    expect(await hasOriginRemote(root)).toBe(false)
    await gitOut(root, ['remote', 'add', 'origin', 'https://github.com/me/shop.git'])
    expect(await hasOriginRemote(root)).toBe(true)
    await gitOut(root, ['remote', 'add', 'upstream', 'https://github.com/other/shop.git'])
    await gitOut(root, ['remote', 'remove', 'origin'])
    expect(await hasOriginRemote(root)).toBe(false)
  })

  it('is false for a folder that is not a git repository', async () => {
    const plain = path.join(dir, 'plain')
    await fs.mkdir(plain)
    expect(await hasOriginRemote(plain)).toBe(false)
    expect(await hasOriginRemote(path.join(dir, 'missing'))).toBe(false)
  })
})
