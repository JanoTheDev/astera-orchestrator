import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { localNameOf, parseRegistryPage, registrySearchUrl } from './mcpRegistry'

// Recorded from registry.modelcontextprotocol.io/v0/servers on 2026-10-24 (search filesystem, sqlite,
// github), trimmed to one server per case, plus two made-up ones for the cases the registry did not show.
const page = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/registry-servers.json'), 'utf8')) as unknown

const byId = (id: string) => {
  const r = parseRegistryPage(page)
  if (!r) throw new Error('fixture did not parse')
  const s = r.servers.find((x) => x.id === id)
  if (!s) throw new Error(`no ${id}`)
  return s
}

describe('registrySearchUrl', () => {
  it('asks for the latest versions matching the query, with the cursor when paging', () => {
    const u = new URL(registrySearchUrl('git hub', 20, 'a:1'))
    expect(u.origin + u.pathname).toBe('https://registry.modelcontextprotocol.io/v0/servers')
    expect(u.searchParams.get('search')).toBe('git hub')
    expect(u.searchParams.get('limit')).toBe('20')
    expect(u.searchParams.get('version')).toBe('latest')
    expect(u.searchParams.get('cursor')).toBe('a:1')
  })
})

describe('parseRegistryPage', () => {
  it('reads the next cursor', () => {
    expect(parseRegistryPage(page)?.nextCursor).toBe('io.github.next:1.0.0')
  })

  it('maps an npm package to npx -y <pkg>@<version> and keeps its env vars', () => {
    const s = byId('io.github.arifulislamat/database-mcp-sqlite')
    expect(s.recipe).toEqual({
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@database-mcp/sqlite@0.5.0'],
      env: [{ name: 'SQLITE_PATH', description: 'Path to the SQLite database file', required: true, secret: false }]
    })
    expect(s.name).toBe('database-mcp-sqlite')
    expect(s.repositoryUrl).toBe('https://github.com/arifulislamat/database-mcp')
  })

  it('maps a PyPI package to uvx <pkg>', () => {
    expect(byId('io.github.Oncorporation/filesystem-server').recipe).toEqual({
      kind: 'stdio',
      command: 'uvx',
      args: ['vs-filesystem-mcp-server'],
      env: []
    })
  })

  it('maps a streamable-http remote to an http URL with its headers as inputs', () => {
    const r = byId('ai.smithery/smithery-ai-github').recipe
    expect(r).toEqual({
      kind: 'http',
      transport: 'http',
      url: 'https://server.smithery.ai/@smithery-ai/github/mcp',
      headers: [
        {
          name: 'Authorization',
          description: 'Bearer token for Smithery authentication',
          required: true,
          secret: true,
          hint: 'Bearer {smithery_api_key}'
        }
      ]
    })
  })

  it('shows a NuGet-only server but does not install it', () => {
    const s = byId('io.github.fieldcure/filesystem')
    expect(s.recipe).toBeNull()
    expect(s.notInstallable).toMatch(/nuget/)
  })

  it('prefers the npm package over an OCI image of the same server', () => {
    expect(byId('io.github.j0hanz/filesystem-mcp').recipe).toMatchObject({ command: 'npx', args: ['-y', '@j0hanz/filesystem-mcp@2.10.1'] })
  })

  it('refuses a URL with variables in it and an identifier that would read as a flag', () => {
    expect(byId('com.example/templated').recipe).toBeNull()
    expect(byId('com.example/evil').recipe).toBeNull()
  })

  it('refuses a package with a required argument the finder cannot fill', () => {
    const r = parseRegistryPage({
      servers: [
        {
          server: {
            name: 'x/needs-dir',
            version: '1.0.0',
            packages: [
              {
                registryType: 'npm',
                identifier: 'needs-dir',
                version: '1.0.0',
                transport: { type: 'stdio' },
                packageArguments: [{ type: 'positional', valueHint: 'dir', isRequired: true }]
              }
            ]
          }
        }
      ]
    })
    expect(r?.servers[0].recipe).toBeNull()
  })

  it('answers null for something that is not a registry page', () => {
    expect(parseRegistryPage({ nope: 1 })).toBeNull()
    expect(parseRegistryPage('x')).toBeNull()
  })
})

describe('localNameOf', () => {
  it('takes the last segment in the charset both clients accept', () => {
    expect(localNameOf('io.github.owner/my.server')).toBe('my-server')
    expect(localNameOf('com.example/a b@c')).toBe('a-b-c')
  })
})
