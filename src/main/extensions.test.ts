import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeExtensions, MCP_NOTE, SKILLS_CACHE_MS, type ExtensionsDeps } from './extensions'
import { STUB_MARKER } from './orchestration/stub'
import { makeDescriptors } from '../core/providers/descriptor'
import { removeFixture } from '../core/testFixtures'
import type { Account, McpClient, McpRecipe } from '../core/types'
import type { CliRun } from '../core/install/mcpClients'

const COMMIT = 'dbd4588f9e1033efb41dad4bef2f7947c8993d44'
const registryPage = readFileSync(path.join(__dirname, '../core/extensions/fixtures/registry-servers.json'), 'utf8')

let dir: string
let home: string
let accounts: Account[]
let calls: { client: McpClient; args: string[]; env: Record<string, string | undefined> }[]
let fetched: string[]
let runAnswer: CliRun
let clock: number

const account = (id: string, configDir: string, provider: 'claude' | 'codex'): Account => ({
  id,
  label: id,
  configDir,
  color: '#000',
  createdAt: '2026-10-24T00:00:00Z',
  provider
})

// A repo with one skill, `hello`, of two files.
const routes: Record<string, () => Response> = {
  [`https://api.github.com/repos/anthropics/skills/commits/HEAD`]: () => Response.json({ sha: COMMIT }),
  [`https://api.github.com/repos/anthropics/skills/git/trees/${COMMIT}?recursive=1`]: () =>
    Response.json({
      sha: COMMIT,
      truncated: false,
      tree: [
        { path: 'skills/hello', type: 'tree', mode: '040000' },
        { path: 'skills/hello/SKILL.md', type: 'blob', mode: '100644', size: 60 },
        { path: 'skills/hello/scripts/run.sh', type: 'blob', mode: '100644', size: 9 }
      ]
    }),
  [`https://raw.githubusercontent.com/anthropics/skills/${COMMIT}/skills/hello/SKILL.md`]: () =>
    new Response('---\nname: hello\ndescription: Says hello to people\n---\n# Hello\n'),
  [`https://raw.githubusercontent.com/anthropics/skills/${COMMIT}/skills/hello/scripts/run.sh`]: () => new Response('echo hi\n')
}

function deps(over: Partial<ExtensionsDeps> = {}): ExtensionsDeps {
  return {
    accounts: () => accounts,
    descriptors: makeDescriptors('linux', home),
    homeDir: home,
    platform: 'linux',
    env: { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/inherited', CODEX_HOME: '/inherited' },
    fetch: (async (input: string | URL | Request) => {
      const url = String(input)
      fetched.push(url)
      if (url.startsWith('https://registry.modelcontextprotocol.io/')) return new Response(registryPage)
      const route = routes[url]
      return route ? route() : new Response('nope', { status: 404 })
    }) as typeof fetch,
    // The fake client CLI: records what it was asked and answers runAnswer.
    run: async (client, args, env) => {
      calls.push({ client, args, env })
      return runAnswer
    },
    skillRepos: () => [],
    now: () => clock,
    ...over
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-extensions-'))
  home = path.join(dir, 'home')
  accounts = [
    account('home', path.join(home, '.claude'), 'claude'),
    account('work', path.join(dir, 'claude-work'), 'claude'),
    account('cx', path.join(dir, 'codex-a'), 'codex')
  ]
  for (const a of accounts) await fs.mkdir(a.configDir, { recursive: true })
  calls = []
  fetched = []
  runAnswer = { ok: true, stdout: '', stderr: '' }
  clock = 1_000
})

afterEach(async () => {
  await removeFixture(dir)
})

const NPX: McpRecipe = { kind: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0'], env: [] }

describe('mcpSearch', () => {
  it('answers installable recipes from the registry', async () => {
    const r = await makeExtensions(deps()).mcpSearch('github')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.servers.some((s) => s.recipe !== null)).toBe(true)
    expect(r.nextCursor).toBe('io.github.next:1.0.0')
    expect(fetched[0]).toContain('search=github')
  })

  it('answers a network error as a value', async () => {
    const r = await makeExtensions(
      deps({
        fetch: (async () => {
          throw new Error('offline')
        }) as typeof fetch
      })
    ).mcpSearch('x')
    expect(r).toMatchObject({ ok: false, error: 'network' })
  })
})

describe('MCP servers per account', () => {
  it('lists each account from its own config, never astera and never env values', async () => {
    await fs.mkdir(home, { recursive: true })
    await fs.writeFile(
      path.join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { astera: { command: 'astera' }, db: { command: 'npx', env: { T: 'secret' } } } })
    )
    await fs.writeFile(path.join(dir, 'claude-work', '.claude.json'), JSON.stringify({ mcpServers: { gh: { type: 'http', url: 'https://x' } } }))
    await fs.writeFile(path.join(dir, 'codex-a', 'config.toml'), '[mcp_servers.astera]\ncommand = "a"\n[mcp_servers.fs]\ncommand = "uvx"\n')
    const list = await makeExtensions(deps()).mcpInstalled()
    expect(list).toEqual([
      { accountId: 'home', name: 'db', transport: 'stdio', command: 'npx' },
      { accountId: 'work', name: 'gh', transport: 'http', url: 'https://x' },
      { accountId: 'cx', name: 'fs', transport: 'stdio', command: 'uvx' }
    ])
    expect(JSON.stringify(list)).not.toContain('secret')
  })

  it("installs through each client's CLI with the account's config dir, unset for the home account", async () => {
    const r = await makeExtensions(deps()).mcpInstall({
      accountIds: ['home', 'work', 'cx'],
      name: 'db',
      recipe: NPX,
      values: { TOKEN: 't' }
    })
    expect(r.note).toBe(MCP_NOTE)
    expect(r.results.every((x) => x.ok)).toBe(true)
    expect(calls.map((c) => [c.client, c.args])).toEqual([
      ['claude', ['mcp', 'add', '-s', 'user', 'db', '-e', 'TOKEN=t', '--', 'npx', '-y', 'pkg@1.0.0']],
      ['claude', ['mcp', 'add', '-s', 'user', 'db', '-e', 'TOKEN=t', '--', 'npx', '-y', 'pkg@1.0.0']],
      ['codex', ['mcp', 'add', 'db', '--env', 'TOKEN=t', '--', 'npx', '-y', 'pkg@1.0.0']]
    ])
    expect(calls[0].env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(calls[1].env.CLAUDE_CONFIG_DIR).toBe(path.join(dir, 'claude-work'))
    expect(calls[2].env.CODEX_HOME).toBe(path.join(dir, 'codex-a'))
  })

  it('refuses astera, a name already set up, and a recipe that is not one', async () => {
    await fs.writeFile(path.join(dir, 'claude-work', '.claude.json'), JSON.stringify({ mcpServers: { db: { command: 'x' } } }))
    const ext = makeExtensions(deps())
    const astera = await ext.mcpInstall({ accountIds: ['work'], name: 'astera', recipe: NPX, values: {} })
    const taken = await ext.mcpInstall({ accountIds: ['work'], name: 'db', recipe: NPX, values: {} })
    const forged = await ext.mcpInstall({ accountIds: ['work'], name: 'x', recipe: { ...NPX, command: 'sh' }, values: {} })
    expect(astera.results[0]).toMatchObject({ ok: false, error: 'refused' })
    expect(taken.results[0]).toMatchObject({ ok: false, error: 'refused' })
    expect(forged.results[0]).toMatchObject({ ok: false, error: 'invalid' })
    expect(calls).toEqual([])
  })

  it('removes through the CLI only a server the account has, never astera', async () => {
    await fs.writeFile(path.join(dir, 'claude-work', '.claude.json'), JSON.stringify({ mcpServers: { astera: {}, db: { command: 'x' } } }))
    const ext = makeExtensions(deps())
    expect(await ext.mcpRemove('work', 'db')).toEqual({ accountId: 'work', ok: true })
    expect(calls[0].args).toEqual(['mcp', 'remove', '-s', 'user', 'db'])
    expect(calls[0].env.CLAUDE_CONFIG_DIR).toBe(path.join(dir, 'claude-work'))
    expect(await ext.mcpRemove('work', 'astera')).toMatchObject({ ok: false, error: 'refused' })
    expect(await ext.mcpRemove('work', 'nothere')).toMatchObject({ ok: false })
    expect(calls).toHaveLength(1)
  })

  it("answers the CLI's first line when it fails", async () => {
    runAnswer = { ok: false, stdout: '', stderr: '\nError: boom\nmore' }
    const r = await makeExtensions(deps()).mcpInstall({ accountIds: ['cx'], name: 'db', recipe: NPX, values: {} })
    expect(r.results[0]).toEqual({ accountId: 'cx', ok: false, error: 'cli', message: 'Error: boom' })
  })
})

describe('skills', () => {
  const skillDir = (a: number, name: string) => path.join(accounts[a].configDir, 'skills', name)

  it('searches by name or description and caches the repo for ten minutes', async () => {
    const ext = makeExtensions(deps())
    const r = await ext.skillsSearch('HELLO TO')
    expect(r).toEqual({
      skills: [{ repo: 'anthropics/skills', path: 'skills/hello', name: 'hello', description: 'Says hello to people', commit: COMMIT }],
      errors: []
    })
    const n = fetched.length
    expect((await ext.skillsSearch('nothing-matches')).skills).toEqual([])
    expect(fetched.length).toBe(n)
    clock += SKILLS_CACHE_MS
    await ext.skillsSearch('')
    expect(fetched.length).toBeGreaterThan(n)
  })

  it('names a repo that could not be read without failing the others', async () => {
    const r = await makeExtensions(deps({ skillRepos: () => ['someone/missing'] })).skillsSearch('')
    expect(r.skills).toHaveLength(1)
    expect(r.errors).toEqual([{ repo: 'someone/missing', message: expect.stringContaining('someone/missing') }])
  })

  it('installs the files and the finder marker into each account, claude and codex', async () => {
    const r = await makeExtensions(deps()).skillsInstall({ accountIds: ['work', 'cx'], repo: 'anthropics/skills', path: 'skills/hello' })
    expect(r.results).toEqual([
      { accountId: 'work', ok: true },
      { accountId: 'cx', ok: true }
    ])
    expect(r.note).toMatch(/new session/)
    for (const a of [1, 2]) {
      expect(await fs.readFile(path.join(skillDir(a, 'hello'), 'scripts', 'run.sh'), 'utf8')).toBe('echo hi\n')
      expect(JSON.parse(await fs.readFile(path.join(skillDir(a, 'hello'), '.astera-finder.json'), 'utf8'))).toEqual({
        repo: 'anthropics/skills',
        path: 'skills/hello',
        commit: COMMIT
      })
    }
    // Nothing temporary is left beside it.
    expect(await fs.readdir(path.join(accounts[1].configDir, 'skills'))).toEqual(['hello'])
  })

  it('refuses a folder it did not install, replaces one it did, and refuses unsafe paths', async () => {
    const ext = makeExtensions(deps())
    await fs.mkdir(skillDir(1, 'hello'), { recursive: true })
    await fs.writeFile(path.join(skillDir(1, 'hello'), 'SKILL.md'), 'mine')
    const refused = await ext.skillsInstall({ accountIds: ['work'], repo: 'anthropics/skills', path: 'skills/hello' })
    expect(refused.results[0]).toMatchObject({ ok: false, error: 'refused' })
    expect(await fs.readFile(path.join(skillDir(1, 'hello'), 'SKILL.md'), 'utf8')).toBe('mine')

    await ext.skillsInstall({ accountIds: ['cx'], repo: 'anthropics/skills', path: 'skills/hello' })
    await fs.writeFile(path.join(skillDir(2, 'hello'), 'stale.txt'), 'old')
    expect((await ext.skillsInstall({ accountIds: ['cx'], repo: 'anthropics/skills', path: 'skills/hello' })).results[0].ok).toBe(true)
    await expect(fs.access(path.join(skillDir(2, 'hello'), 'stale.txt'))).rejects.toThrow()

    for (const bad of [{ repo: '../x', path: 'skills/hello' }, { repo: 'anthropics/skills', path: '../../etc' }]) {
      expect((await ext.skillsInstall({ accountIds: ['work'], ...bad })).results[0]).toMatchObject({ ok: false, error: 'invalid' })
    }
  })

  it("lists origins, and removes only the finder's folders, never Astera's stubs", async () => {
    const ext = makeExtensions(deps())
    await ext.skillsInstall({ accountIds: ['work'], repo: 'anthropics/skills', path: 'skills/hello' })
    await fs.mkdir(skillDir(1, 'astera-orchestration'), { recursive: true })
    await fs.writeFile(path.join(skillDir(1, 'astera-orchestration'), 'SKILL.md'), `---\nname: a\n---\n<!-- ${STUB_MARKER} -->\n`)
    await fs.mkdir(skillDir(1, 'mine'), { recursive: true })
    await fs.writeFile(path.join(skillDir(1, 'mine'), 'SKILL.md'), '---\ndescription: my own\n---\n')

    const list = (await ext.skillsInstalled()).filter((s) => s.accountId === 'work').sort((a, b) => a.name.localeCompare(b.name))
    expect(list).toEqual([
      { accountId: 'work', name: 'astera-orchestration', description: '', origin: 'astera' },
      {
        accountId: 'work',
        name: 'hello',
        description: 'Says hello to people',
        origin: 'finder',
        source: { repo: 'anthropics/skills', path: 'skills/hello', commit: COMMIT }
      },
      { accountId: 'work', name: 'mine', description: 'my own', origin: 'user' }
    ])

    expect(await ext.skillsRemove('work', 'astera-orchestration')).toMatchObject({ ok: false, error: 'refused' })
    expect(await ext.skillsRemove('work', 'mine')).toMatchObject({ ok: false, error: 'refused' })
    expect(await ext.skillsRemove('work', '..')).toMatchObject({ ok: false, error: 'invalid' })
    expect(await ext.skillsRemove('work', 'hello')).toEqual({ accountId: 'work', ok: true })
    expect((await fs.readdir(path.join(accounts[1].configDir, 'skills'))).sort()).toEqual(['astera-orchestration', 'mine'])
  })
})
