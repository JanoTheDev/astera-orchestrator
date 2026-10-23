import { describe, it, expect } from 'vitest'
import { claudeServersFrom, codexServersFrom, mcpAddArgs, mcpRemoveArgs, recipeOf } from './mcpConfig'
import type { McpRecipe } from '../types'

const NPX: McpRecipe = { kind: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0'], env: [] }
const HTTP: McpRecipe = { kind: 'http', transport: 'http', url: 'https://x.example/mcp', headers: [] }

describe('mcpAddArgs', () => {
  it('adds a stdio server at user scope with -e for claude and --env for codex', () => {
    expect(mcpAddArgs('claude', 'db', NPX, { KEY: 'v', EMPTY: '' }, 'linux')).toEqual({
      args: ['mcp', 'add', '-s', 'user', 'db', '-e', 'KEY=v', '--', 'npx', '-y', 'pkg@1.0.0']
    })
    expect(mcpAddArgs('codex', 'db', NPX, { KEY: 'v' }, 'linux')).toEqual({
      args: ['mcp', 'add', 'db', '--env', 'KEY=v', '--', 'npx', '-y', 'pkg@1.0.0']
    })
  })

  it('runs npx through cmd /c on win32', () => {
    expect(mcpAddArgs('claude', 'db', NPX, {}, 'win32')).toMatchObject({ args: expect.arrayContaining(['--', 'cmd', '/c', 'npx']) })
  })

  it('adds an http server with headers for claude, and only a bare URL for codex', () => {
    expect(mcpAddArgs('claude', 'gh', HTTP, { Authorization: 'Bearer t' }, 'linux')).toEqual({
      args: ['mcp', 'add', '-s', 'user', '--transport', 'http', 'gh', 'https://x.example/mcp', '-H', 'Authorization: Bearer t']
    })
    expect(mcpAddArgs('codex', 'gh', HTTP, {}, 'linux')).toEqual({ args: ['mcp', 'add', 'gh', '--url', 'https://x.example/mcp'] })
    expect(mcpAddArgs('codex', 'gh', HTTP, { Authorization: 'x' }, 'linux')).toHaveProperty('refused')
    expect(mcpAddArgs('codex', 'gh', { ...HTTP, transport: 'sse' }, {}, 'linux')).toHaveProperty('refused')
  })

  it('refuses the astera name, names outside the charset, bad keys and values with line breaks', () => {
    expect(mcpAddArgs('claude', 'astera', NPX, {}, 'linux')).toHaveProperty('refused')
    expect(mcpAddArgs('claude', 'a b', NPX, {}, 'linux')).toHaveProperty('refused')
    expect(mcpAddArgs('claude', 'db', NPX, { 'A-B': 'x' }, 'linux')).toHaveProperty('refused')
    expect(mcpAddArgs('claude', 'db', NPX, { KEY: 'a\nb' }, 'linux')).toHaveProperty('refused')
  })
})

describe('mcpRemoveArgs', () => {
  it('removes at user scope for claude', () => {
    expect(mcpRemoveArgs('claude', 'db')).toEqual(['mcp', 'remove', '-s', 'user', 'db'])
    expect(mcpRemoveArgs('codex', 'db')).toEqual(['mcp', 'remove', 'db'])
  })
})

describe('recipeOf', () => {
  it('keeps a recipe as mcpSearch answers it and refuses anything that would add a flag or another runner', () => {
    expect(recipeOf(NPX)).toEqual(NPX)
    expect(recipeOf(HTTP)).toEqual(HTTP)
    expect(recipeOf({ ...NPX, command: 'sh' })).toBeNull()
    expect(recipeOf({ ...NPX, args: ['-y', '--registry=evil'] })).toBeNull()
    expect(recipeOf({ ...HTTP, url: 'file:///etc/passwd' })).toBeNull()
  })
})

describe('claudeServersFrom', () => {
  it('lists user-scope servers without astera and without their env', () => {
    const text = JSON.stringify({
      mcpServers: {
        astera: { command: 'astera', args: ['mcp', 'serve'] },
        db: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'secret' } },
        gh: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'secret' } }
      },
      projects: {}
    })
    const servers = claudeServersFrom(text)
    expect(servers).toEqual([
      { name: 'db', transport: 'stdio', command: 'npx' },
      { name: 'gh', transport: 'http', url: 'https://x.example/mcp' }
    ])
    expect(JSON.stringify(servers)).not.toContain('secret')
    expect(claudeServersFrom(null)).toEqual([])
    expect(claudeServersFrom('{not json')).toEqual([])
  })
})

describe('codexServersFrom', () => {
  it('lists [mcp_servers.*] tables without astera and without their env', () => {
    const text = [
      'model = "gpt-5"',
      '[mcp_servers.astera]',
      'command = "astera"',
      '[mcp_servers.db]',
      'command = "npx"',
      'args = ["-y", "x"]',
      '[mcp_servers.db.env]',
      'TOKEN = "secret"',
      '[mcp_servers."gh"]',
      'url = "https://x.example/mcp"',
      '[profiles.x]',
      'command = "nope"'
    ].join('\n')
    expect(codexServersFrom(text)).toEqual([
      { name: 'db', transport: 'stdio', command: 'npx' },
      { name: 'gh', transport: 'http', url: 'https://x.example/mcp' }
    ])
  })
})
