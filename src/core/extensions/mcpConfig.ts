// What the MCP finder hands each client's CLI, and what it reads back from each account's config.
// Installing and removing go through `claude mcp add|remove -s user` and `codex mcp add|remove`, as
// Astera's own registration does (core/install/mcpClients.ts); the config files are only read.
//
// The `astera` entry belongs to Settings › CLI (McpSettings): it is never listed here, and a request
// to add or remove that name is refused.

import { ENV_NAME, HEADER_NAME } from './mcpRegistry'
import type { McpClient, McpInstalled, McpRecipe } from '../types'

/** The name core/install/mcpClients.ts registers Astera under. */
export const ASTERA_MCP_NAME = 'astera'
/** The charset Codex accepts for a server name, and Claude Code with it. */
export const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Why `name` cannot be added or removed here, or null. */
export function mcpNameRefusal(name: string): string | null {
  if (!MCP_NAME.test(name)) return 'a server name may only hold letters, digits, - and _ (at most 64)'
  if (name.toLowerCase() === ASTERA_MCP_NAME) return 'the astera entry is managed in Settings › CLI'
  return null
}

/** A recipe from the renderer, re-checked: the renderer sends back what mcpSearch answered, but it is
 *  still a value that crossed IPC, and it becomes a command line. */
export function recipeOf(v: unknown): McpRecipe | null {
  if (!isObject(v)) return null
  if (v.kind === 'stdio') {
    if (v.command !== 'npx' && v.command !== 'uvx') return null
    // Every word after the runner's own `-y` is a package spec, never a flag.
    if (!isStrings(v.args) || v.args.some((a, i) => a.startsWith('-') && !(i === 0 && a === '-y'))) return null
    if (!Array.isArray(v.env)) return null
    return { kind: 'stdio', command: v.command, args: v.args, env: [] }
  }
  if (v.kind === 'http') {
    if (v.transport !== 'http' && v.transport !== 'sse') return null
    if (typeof v.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(v.url)) return null
    return { kind: 'http', transport: v.transport, url: v.url, headers: [] }
  }
  return null
}

/** `claude|codex mcp add` words for `recipe` with the person's values (env vars for stdio, headers for
 *  http), or why it cannot be added. On win32 npx and uvx run through `cmd /c`, as Claude Code asks for. */
export function mcpAddArgs(
  client: McpClient,
  name: string,
  recipe: McpRecipe,
  values: Record<string, string>,
  platform: string
): { args: string[] } | { refused: string } {
  const refused = mcpNameRefusal(name)
  if (refused) return { refused }
  const given = Object.entries(values).filter(([, v]) => v !== '')
  for (const [k, v] of given) {
    if (/[\r\n\0]/.test(v)) return { refused: `the value for ${k} has a line break in it` }
  }
  if (recipe.kind === 'stdio') {
    const bad = given.find(([k]) => !ENV_NAME.test(k))
    if (bad) return { refused: `${bad[0]} is not an environment variable name` }
    const run = platform === 'win32' ? ['cmd', '/c', recipe.command] : [recipe.command]
    const env = given.flatMap(([k, v]) => [client === 'claude' ? '-e' : '--env', `${k}=${v}`])
    const scope = client === 'claude' ? ['-s', 'user'] : []
    return { args: ['mcp', 'add', ...scope, name, ...env, '--', ...run, ...recipe.args] }
  }
  const bad = given.find(([k]) => !HEADER_NAME.test(k))
  if (bad) return { refused: `${bad[0]} is not a header name` }
  if (client === 'claude') {
    const headers = given.flatMap(([k, v]) => ['-H', `${k}: ${v}`])
    return { args: ['mcp', 'add', '-s', 'user', '--transport', recipe.transport, name, recipe.url, ...headers] }
  }
  // codex mcp add takes a streamable-http URL and no headers; writing config.toml by hand is not done here.
  if (recipe.transport === 'sse') return { refused: 'Codex does not run SSE servers' }
  if (given.length > 0) return { refused: 'Codex cannot be given headers from its CLI; add this server to config.toml by hand' }
  return { args: ['mcp', 'add', name, '--url', recipe.url] }
}

export function mcpRemoveArgs(client: McpClient, name: string): string[] {
  return client === 'claude' ? ['mcp', 'remove', '-s', 'user', name] : ['mcp', 'remove', name]
}

type Server = Omit<McpInstalled, 'accountId'>

/** User-scope servers in the text of `.claude.json` (top-level `mcpServers`), astera left out. Only
 *  the command or URL is read: env and headers hold tokens. */
export function claudeServersFrom(text: string | null): Server[] {
  if (text === null) return []
  let config: unknown
  try {
    config = JSON.parse(text)
  } catch {
    return []
  }
  const servers = isObject(config) && isObject(config.mcpServers) ? config.mcpServers : {}
  return Object.entries(servers).flatMap(([name, e]): Server[] => {
    if (name === ASTERA_MCP_NAME || !isObject(e)) return []
    const transport = e.type === 'http' || e.type === 'sse' ? e.type : 'stdio'
    return [
      {
        name,
        transport,
        ...(typeof e.command === 'string' ? { command: e.command } : {}),
        ...(typeof e.url === 'string' ? { url: e.url } : {})
      }
    ]
  })
}

const TABLE = /^\[\s*mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/
const KEY = /^(command|url)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/

/** `[mcp_servers.<name>]` tables in the text of Codex's `config.toml`, astera left out.
 *  shortcut: reads table headers and their `command`/`url` lines, not TOML; inline-table or dotted-key
 *  forms are not listed. Upgrade to a TOML parser if Codex starts writing those. */
export function codexServersFrom(text: string | null): Server[] {
  if (text === null) return []
  const out: Server[] = []
  let current: Server | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      const m = TABLE.exec(line)
      const name = m ? (m[1] ?? m[2] ?? m[3]) : null
      current = name && name !== ASTERA_MCP_NAME ? { name, transport: 'stdio' } : null
      if (current) out.push(current)
      continue
    }
    const k = current ? KEY.exec(line) : null
    if (!current || !k) continue
    const value = k[2] ?? k[3] ?? ''
    if (k[1] === 'url') {
      current.url = value
      current.transport = 'http'
    } else current.command = value
  }
  return out
}
