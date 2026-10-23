// The MCP & skills finder: search the official MCP registry and GitHub skill repos, and install, list
// and remove MCP servers and skills per Claude/Codex account (core/extensions/ holds the parsing).
//
// - MCP servers go in and out through each client's own CLI (`claude mcp add -s user`, `codex mcp add`)
//   run with the account's CLAUDE_CONFIG_DIR / CODEX_HOME (cliEnvFor); the config files are only read.
//   Astera's own `astera` entry is never listed, added or removed here (Settings › CLI owns it).
// - Skills are folders under `<configDir>/skills/`. The finder writes only folders it marks with
//   FINDER_MARKER and removes or replaces only those; Astera's managed stubs (STUB_MARKER) and anything
//   else are listed read-only.
//
// Every failure is answered as a value: nothing here throws into IPC.

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { locateCli } from './cliLocate'
import { LEGACY_STUB_MARKER, STUB_MARKER } from './orchestration/stub'
import { SKILLS_NOTE } from '../cli/skills'
import { cmdRefusal, executableFor, firstLine, type CliRun } from '../core/install/mcpClients'
import { windowsSpawn } from '../core/sessions/windowsExecutable'
import { cliEnvFor } from '../core/sessions/cliEnv'
import { descriptorOf, isAmbientDir, type ProviderDescriptor } from '../core/providers/descriptor'
import { providerOf, type Provider } from '../core/providers/meta'
import { parseRegistryPage, registrySearchUrl } from '../core/extensions/mcpRegistry'
import {
  claudeServersFrom,
  codexServersFrom,
  mcpAddArgs,
  mcpNameRefusal,
  mcpRemoveArgs,
  recipeOf
} from '../core/extensions/mcpConfig'
import {
  commitShaOf,
  commitUrl,
  DEFAULT_SKILL_REPO,
  FINDER_MARKER,
  finderMarkerOf,
  frontMatterOf,
  isRepo,
  isSafeSegment,
  rawUrl,
  SKILL_MAX_BYTES,
  skillSourcesFromTree,
  treeUrl,
  type SkillSource
} from '../core/extensions/skillsCatalog'
import type {
  Account,
  ExtensionAccountResult,
  ExtensionError,
  ExtensionInstallResult,
  McpClient,
  McpInstalled,
  McpSearchResult,
  SkillCatalogEntry,
  SkillInstalled,
  SkillOrigin,
  SkillsSearchResult
} from '../core/types'

export const MCP_NOTE = 'Sessions already open do not pick up new MCP servers; open a new session to use them.'
const PAGE_SIZE = 30
const FETCH_TIMEOUT_MS = 15_000
const CLI_TIMEOUT_MS = 60_000
/** How long a repo's skill list is reused before GitHub is asked again (60 unauthenticated calls an hour). */
export const SKILLS_CACHE_MS = 10 * 60_000

export interface ExtensionsDeps {
  accounts(): Account[]
  descriptors: Record<Provider, ProviderDescriptor>
  homeDir: string
  platform: string
  /** The environment the client CLIs start from (cliEnvFor sets the account's config dir on a copy). */
  env: NodeJS.ProcessEnv
  fetch: typeof fetch
  run(client: McpClient, args: string[], env: Record<string, string | undefined>): Promise<CliRun>
  /** The repos the person added (the default repo is always searched too). */
  skillRepos(): string[]
  now?: () => number
}

const fail = (error: ExtensionError['error'], message: string): ExtensionError => ({ ok: false, error, message })
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** Runs a client CLI the way main/mcpClients.ts does (found where the machine says it is now, no
 *  shell, a .cmd through `cmd.exe /d /c call`), with `env`. Kept beside it rather than shared because
 *  that runner has no env and belongs to Astera's own registration. */
export async function runClientCli(client: McpClient, args: string[], env: Record<string, string | undefined>): Promise<CliRun> {
  const found = await locateCli(client)
  const file = found === null ? null : executableFor(client, found, process.platform, process.env)
  if (file === null) return { ok: false, stdout: '', stderr: `${client} is not installed`, notFound: true }
  if (cmdRefusal(file, args, process.platform) !== null)
    return {
      ok: false,
      stdout: '',
      stderr: `${path.win32.basename(file)} runs through cmd, which would read & | < > ^ % ( ) ! or a quote in a value as syntax; add this one by hand`
    }
  const spawn = process.platform === 'win32' ? windowsSpawn(path.win32.basename(file), args, () => file) : { file, args }
  return new Promise((resolve) => {
    execFile(spawn.file, spawn.args, { timeout: CLI_TIMEOUT_MS, windowsHide: true, env }, (err, stdout, stderr) => {
      const code: unknown = err ? (err as { code?: unknown }).code : 0
      resolve({
        ok: !err,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '') || (err && typeof code !== 'number' ? err.message : ''),
        ...(code === 'ENOENT' ? { notFound: true } : {})
      })
    })
  })
}

/** Runs `fn` over `items`, `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

interface RepoSkills {
  at: number
  sources: (SkillSource & { description: string })[]
}

export function makeExtensions(deps: ExtensionsDeps) {
  const now = deps.now ?? Date.now
  const repoCache = new Map<string, RepoSkills>()

  async function get(url: string, as: 'json' | 'bytes'): Promise<unknown> {
    const res = await deps.fetch(url, {
      headers: { 'User-Agent': 'Astera', ...(url.startsWith('https://api.github.com/') ? { Accept: 'application/vnd.github+json' } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
    return as === 'json' ? res.json() : new Uint8Array(await res.arrayBuffer())
  }

  const accountById = (id: unknown): Account | undefined => deps.accounts().find((a) => a.id === id)
  const descriptor = (a: Account): ProviderDescriptor => descriptorOf(deps.descriptors, a)
  const envFor = (a: Account) => cliEnvFor({ base: deps.env, account: a, descriptor: descriptor(a), homeDir: deps.homeDir })

  // ── MCP ──

  /** Where `claude mcp add -s user` writes for this account: `~/.claude.json` for the home account,
   *  whose CLI runs with CLAUDE_CONFIG_DIR unset (cliEnvFor), else `<configDir>/.claude.json`. */
  const claudeConfigFile = (a: Account): string =>
    path.join(isAmbientDir(descriptor(a), deps.homeDir, a.configDir) ? deps.homeDir : a.configDir, '.claude.json')

  async function serversOf(a: Account): Promise<McpInstalled[]> {
    const servers =
      providerOf(a) === 'claude'
        ? claudeServersFrom(await readText(claudeConfigFile(a)))
        : codexServersFrom(await readText(path.join(a.configDir, 'config.toml')))
    return servers.map((s) => ({ accountId: a.id, ...s }))
  }

  async function mcpSearch(query: unknown, cursor?: unknown): Promise<McpSearchResult> {
    if (typeof query !== 'string' || (cursor !== undefined && cursor !== null && typeof cursor !== 'string'))
      return fail('invalid', 'a search is a string')
    let body: unknown
    try {
      body = await get(registrySearchUrl(query.trim(), PAGE_SIZE, cursor || undefined), 'json')
    } catch (err) {
      return fail('network', `the MCP registry could not be reached: ${messageOf(err)}`)
    }
    const page = parseRegistryPage(body)
    return page ? { ok: true, ...page } : fail('invalid', 'the MCP registry answered something that is not a server list')
  }

  async function mcpInstalled(): Promise<McpInstalled[]> {
    return (await Promise.all(deps.accounts().map(serversOf))).flat()
  }

  async function mcpInstall(req: unknown): Promise<ExtensionInstallResult> {
    const r = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const ids = Array.isArray(r.accountIds) ? r.accountIds : []
    const recipe = recipeOf(r.recipe)
    const values = typeof r.values === 'object' && r.values !== null ? (r.values as Record<string, unknown>) : {}
    const name = typeof r.name === 'string' ? r.name : ''
    const bad =
      !recipe ? 'not a recipe mcpSearch gave' : Object.values(values).some((v) => typeof v !== 'string') ? 'every value is a string' : null
    const results: ExtensionAccountResult[] = []
    for (const id of ids) {
      const accountId = String(id)
      if (bad || !recipe) {
        results.push({ accountId, ...fail('invalid', bad ?? 'invalid request') })
        continue
      }
      const a = accountById(id)
      if (!a) {
        results.push({ accountId, ...fail('invalid', 'no such account') })
        continue
      }
      const client = providerOf(a)
      const built = mcpAddArgs(client, name, recipe, values as Record<string, string>, deps.platform)
      if ('refused' in built) {
        results.push({ accountId, ...fail('refused', built.refused) })
        continue
      }
      // codex mcp add replaces a server of the same name; one the person set up is not overwritten here.
      if ((await serversOf(a)).some((s) => s.name === name)) {
        results.push({ accountId, ...fail('refused', `${name} is already set up in this account; remove it first`) })
        continue
      }
      results.push(await runFor(a, client, built.args))
    }
    return { results, note: MCP_NOTE }
  }

  async function runFor(a: Account, client: McpClient, args: string[]): Promise<ExtensionAccountResult> {
    const run = await deps.run(client, args, envFor(a))
    if (run.ok) return { accountId: a.id, ok: true }
    // The CLI's own first line, never the words it was run with: those carry the person's values.
    return { accountId: a.id, ...fail('cli', firstLine(run.stderr) || firstLine(run.stdout) || `${client} ${args.slice(0, 2).join(' ')} failed`) }
  }

  async function mcpRemove(accountId: unknown, name: unknown): Promise<ExtensionAccountResult> {
    const a = accountById(accountId)
    const id = String(accountId)
    if (!a) return { accountId: id, ...fail('invalid', 'no such account') }
    const refused = typeof name === 'string' ? mcpNameRefusal(name) : 'not a server name'
    if (refused !== null || typeof name !== 'string') return { accountId: id, ...fail('refused', refused ?? 'not a server name') }
    if (!(await serversOf(a)).some((s) => s.name === name))
      return { accountId: id, ...fail('invalid', `${name} is not set up in this account`) }
    const client = providerOf(a)
    return runFor(a, client, mcpRemoveArgs(client, name))
  }

  // ── Skills ──

  async function repoSkills(repo: string): Promise<RepoSkills['sources']> {
    const hit = repoCache.get(repo)
    if (hit && now() - hit.at < SKILLS_CACHE_MS) return hit.sources
    const commit = commitShaOf(await get(commitUrl(repo), 'json'))
    if (!commit) throw new Error(`${repo} has no commit to read`)
    const found = skillSourcesFromTree(repo, commit, await get(treeUrl(repo, commit), 'json'))
    const sources = await mapLimit(found, 8, async (s) => {
      const text = await get(rawUrl(repo, commit, `${s.path}/SKILL.md`), 'bytes').then(
        (b) => new TextDecoder().decode(b as Uint8Array),
        () => ''
      )
      return { ...s, description: frontMatterOf(text).description ?? '' }
    })
    repoCache.set(repo, { at: now(), sources })
    return sources
  }

  const reposToSearch = (): string[] => [...new Set([DEFAULT_SKILL_REPO, ...deps.skillRepos()])]

  async function skillsSearch(query: unknown): Promise<SkillsSearchResult> {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
    const skills: SkillCatalogEntry[] = []
    const errors: SkillsSearchResult['errors'] = []
    await Promise.all(
      reposToSearch().map(async (repo) => {
        try {
          for (const s of await repoSkills(repo)) {
            if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) continue
            skills.push({ repo, path: s.path, name: s.name, description: s.description, commit: s.commit })
          }
        } catch (err) {
          errors.push({ repo, message: `could not read ${repo}: ${messageOf(err)}` })
        }
      })
    )
    return { skills, errors }
  }

  const skillsDir = (a: Account): string => path.join(a.configDir, 'skills')

  /** What a folder under skills/ is, by its SKILL.md and the finder's marker. Astera's marker is
   *  checked first, so a managed stub is never read as removable whatever else is in its folder. */
  async function skillAt(dir: string): Promise<{ origin: SkillOrigin; text: string; source?: SkillInstalled['source'] } | null> {
    const st = await fs.lstat(dir).catch(() => null)
    if (!st) return null
    const text = st.isDirectory() ? ((await readText(path.join(dir, 'SKILL.md'))) ?? '') : ''
    if (text.includes(STUB_MARKER) || text.includes(LEGACY_STUB_MARKER)) return { origin: 'astera', text }
    const marker = st.isDirectory() ? finderMarkerOf(await readText(path.join(dir, FINDER_MARKER))) : null
    return marker ? { origin: 'finder', text, source: marker } : { origin: 'user', text }
  }

  async function skillsInstalled(): Promise<SkillInstalled[]> {
    const per = await Promise.all(
      deps.accounts().map(async (a) => {
        const entries = await fs.readdir(skillsDir(a), { withFileTypes: true }).catch(() => [])
        const out: SkillInstalled[] = []
        for (const e of entries) {
          if (e.name.startsWith('.') || !(e.isDirectory() || e.isSymbolicLink())) continue
          const s = await skillAt(path.join(skillsDir(a), e.name))
          if (!s) continue
          out.push({
            accountId: a.id,
            name: e.name,
            description: frontMatterOf(s.text).description ?? '',
            origin: s.origin,
            ...(s.source ? { source: s.source } : {})
          })
        }
        return out
      })
    )
    return per.flat()
  }

  async function download(s: SkillSource): Promise<{ path: string; bytes: Uint8Array }[]> {
    let total = 0
    return mapLimit(s.files, 8, async (f) => {
      const bytes = (await get(rawUrl(s.repo, s.commit, `${s.path}/${f.path}`), 'bytes')) as Uint8Array
      // The tree's sizes were checked; what actually came is checked again.
      total += bytes.byteLength
      if (total > SKILL_MAX_BYTES) throw new Error(`the skill is over ${SKILL_MAX_BYTES / 1024 / 1024} MB`)
      return { path: f.path, bytes }
    })
  }

  /** Writes the skill into a hidden folder beside the target and renames it into place, so a failed
   *  download or write never leaves half a skill under the real name. */
  async function writeSkill(a: Account, s: SkillSource, files: { path: string; bytes: Uint8Array }[]): Promise<ExtensionAccountResult> {
    const target = path.join(skillsDir(a), s.name)
    const existing = await skillAt(target)
    if (existing && existing.origin !== 'finder')
      return {
        accountId: a.id,
        ...fail('refused', `${s.name} already exists in this account and was not installed by the finder`)
      }
    const tmp = path.join(skillsDir(a), `.${s.name}.finder-${randomBytes(4).toString('hex')}`)
    try {
      for (const f of files) {
        const to = path.join(tmp, ...f.path.split('/'))
        await fs.mkdir(path.dirname(to), { recursive: true })
        await fs.writeFile(to, f.bytes)
      }
      await fs.mkdir(tmp, { recursive: true })
      await fs.writeFile(path.join(tmp, FINDER_MARKER), JSON.stringify({ repo: s.repo, path: s.path, commit: s.commit }, null, 2) + '\n')
      if (existing) await fs.rm(target, { recursive: true, force: true })
      await fs.rename(tmp, target)
      return { accountId: a.id, ok: true }
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      return { accountId: a.id, ...fail('invalid', `could not write ${s.name}: ${messageOf(err)}`) }
    }
  }

  async function skillsInstall(req: unknown): Promise<ExtensionInstallResult> {
    const r = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const ids = (Array.isArray(r.accountIds) ? r.accountIds : []).map(String)
    const all = (e: ExtensionError): ExtensionInstallResult => ({ results: ids.map((accountId) => ({ accountId, ...e })), note: SKILLS_NOTE })
    const repo = typeof r.repo === 'string' ? r.repo : ''
    const skillPath = typeof r.path === 'string' ? r.path : ''
    if (!isRepo(repo) || !skillPath.split('/').every(isSafeSegment)) return all(fail('invalid', 'not a skill the finder listed'))
    let files: { path: string; bytes: Uint8Array }[]
    let source: SkillSource | undefined
    try {
      source = (await repoSkills(repo)).find((s) => s.path === skillPath)
      if (!source) return all(fail('invalid', `${repo} has no skill at ${skillPath}`))
      files = await download(source)
    } catch (err) {
      return all(fail('network', `could not download the skill: ${messageOf(err)}`))
    }
    const results: ExtensionAccountResult[] = []
    for (const accountId of ids) {
      const a = accountById(accountId)
      results.push(a ? await writeSkill(a, source, files) : { accountId, ...fail('invalid', 'no such account') })
    }
    return { results, note: SKILLS_NOTE }
  }

  async function skillsRemove(accountId: unknown, name: unknown): Promise<ExtensionAccountResult> {
    const a = accountById(accountId)
    const id = String(accountId)
    if (!a) return { accountId: id, ...fail('invalid', 'no such account') }
    if (typeof name !== 'string' || !isSafeSegment(name)) return { accountId: id, ...fail('invalid', 'not a skill name') }
    const dir = path.join(skillsDir(a), name)
    const s = await skillAt(dir)
    if (!s) return { accountId: id, ...fail('invalid', `${name} is not installed in this account`) }
    if (s.origin !== 'finder') return { accountId: id, ...fail('refused', `${name} was not installed by the finder`) }
    try {
      await fs.rm(dir, { recursive: true, force: true })
      return { accountId: id, ok: true }
    } catch (err) {
      return { accountId: id, ...fail('invalid', `could not remove ${name}: ${messageOf(err)}`) }
    }
  }

  return { mcpSearch, mcpInstalled, mcpInstall, mcpRemove, skillsSearch, skillsInstalled, skillsInstall, skillsRemove }
}

export type Extensions = ReturnType<typeof makeExtensions>
