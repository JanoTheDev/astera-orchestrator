// The MCP finder's catalog: the official MCP registry (registry.modelcontextprotocol.io), read as data.
// Each server is mapped to a recipe the clients' own `mcp add` can take: an npm package started by
// `npx -y <pkg>@<version>`, a PyPI one by `uvx <pkg>`, or a remote URL. Anything else (an OCI image, a
// NuGet or cargo package, an .mcpb bundle) is shown but not installable.
//
// Everything here came from the network, so every word that ends up on a command line is checked
// against a strict charset first: an identifier like `--yes-run-me` would otherwise be read as a flag.

import type { McpCatalogEntry, McpInput, McpRecipe } from '../types'

export const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function registrySearchUrl(query: string, limit: number, cursor?: string): string {
  const u = new URL(MCP_REGISTRY_URL)
  u.searchParams.set('search', query)
  u.searchParams.set('limit', String(limit))
  // Only the newest version of each server; the registry otherwise lists every published one.
  u.searchParams.set('version', 'latest')
  if (cursor) u.searchParams.set('cursor', cursor)
  return u.toString()
}

const NPM_ID = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const PYPI_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/
/** Env var names as a shell would take them; header names as HTTP tokens. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

/** The local name a registry server is suggested under: its last segment, in `[A-Za-z0-9_-]`. */
export function localNameOf(registryName: string): string {
  const last = registryName.split('/').pop() ?? registryName
  return (
    last
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'server'
  )
}

function inputsOf(list: unknown, names: RegExp): McpInput[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((v): McpInput[] => {
    if (!isObject(v) || !names.test(str(v.name))) return []
    const value = str(v.value) || str(v.default)
    const templated = value.includes('{')
    return [
      {
        name: str(v.name),
        description: str(v.description),
        required: v.isRequired === true,
        secret: v.isSecret === true,
        ...(value && !templated ? { default: value } : {}),
        ...(templated ? { hint: value } : {})
      }
    ]
  })
}

/** A recipe for one package, or why it cannot be one. */
function packageRecipe(p: Record<string, unknown>): McpRecipe | string {
  const type = str(p.registryType)
  if (type !== 'npm' && type !== 'pypi') return `${type || 'unknown'} packages cannot be installed here`
  if (!isObject(p.transport) || p.transport.type !== 'stdio') return 'only stdio packages can be installed here'
  // An argument the server needs that only the person could fill (a folder, a database). Asking for
  // package arguments is not something the finder does; the server is shown, not installed.
  if (Array.isArray(p.packageArguments) && p.packageArguments.some((a) => isObject(a) && a.isRequired === true))
    return 'it needs arguments the finder cannot fill in'
  const id = str(p.identifier)
  const version = str(p.version)
  if (version && !VERSION.test(version)) return 'its version is not a plain version'
  const env = inputsOf(p.environmentVariables, ENV_NAME)
  if (type === 'npm') {
    if (!NPM_ID.test(id)) return 'its npm name is not a plain package name'
    return { kind: 'stdio', command: 'npx', args: ['-y', version ? `${id}@${version}` : id], env }
  }
  if (!PYPI_ID.test(id)) return 'its PyPI name is not a plain package name'
  return { kind: 'stdio', command: 'uvx', args: [id], env }
}

function remoteRecipe(r: Record<string, unknown>): McpRecipe | string {
  const transport = r.type === 'streamable-http' ? 'http' : r.type === 'sse' ? 'sse' : null
  if (!transport) return `${str(r.type) || 'unknown'} remotes cannot be installed here`
  const url = str(r.url)
  // A `{variable}` in the URL is a value the person would have to put in by hand.
  if (url.includes('{')) return 'its URL has variables in it'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'its URL is not valid'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'its URL is not http(s)'
  return { kind: 'http', transport, url, headers: inputsOf(r.headers, HEADER_NAME) }
}

function entryOf(item: unknown): McpCatalogEntry | null {
  const server = isObject(item) && isObject(item.server) ? item.server : null
  if (!server || !str(server.name)) return null
  // Packages first (they run locally), then remotes; the first that maps wins.
  const tries: (McpRecipe | string)[] = [
    ...(Array.isArray(server.packages) ? server.packages.filter(isObject).map(packageRecipe) : []),
    ...(Array.isArray(server.remotes) ? server.remotes.filter(isObject).map(remoteRecipe) : [])
  ]
  const recipe = tries.find((t): t is McpRecipe => typeof t !== 'string') ?? null
  const repo = isObject(server.repository) ? str(server.repository.url) : ''
  const website = str(server.websiteUrl)
  return {
    id: str(server.name),
    name: localNameOf(str(server.name)),
    title: str(server.title) || str(server.name),
    description: str(server.description),
    version: str(server.version),
    ...(repo ? { repositoryUrl: repo } : {}),
    ...(website ? { websiteUrl: website } : {}),
    recipe,
    ...(recipe ? {} : { notInstallable: (tries[0] as string | undefined) ?? 'it has no package or remote' })
  }
}

/** One page of `GET /v0/servers`, or null when the body is not one. */
export function parseRegistryPage(json: unknown): { servers: McpCatalogEntry[]; nextCursor: string | null } | null {
  if (!isObject(json) || !Array.isArray(json.servers)) return null
  const servers = json.servers.map(entryOf).filter((s): s is McpCatalogEntry => s !== null)
  const next = isObject(json.metadata) ? str(json.metadata.nextCursor) : ''
  return { servers, nextCursor: next || null }
}
