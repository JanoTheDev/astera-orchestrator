// A plugin's manifest: the `astera` field of its package.json (SDK + Plugin spec §10, plugin runtime design P3). Pure,
// so the Host, the CLI and the app read a plugin by the same rules. What it may ask Astera for is design §2's table;
// whether this Astera runs it is `incompatibility` (spec §29).

import { parseSettingsSchema, type SettingField } from './settings'

/** The Plugin API versions this Astera speaks (spec §28): versioned apart from the Host protocol. */
export const PLUGIN_API_VERSIONS = ['1'] as const

/** Spec §10's P0 capability types. Which of them this Astera serves is the Host's to say (design P8). */
export const PLUGIN_CAPABILITIES = ['event', 'job-source', 'completion-check', 'notification'] as const
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

/** Spec §11's permissions, completed so that every SDK command has exactly one (design §2). */
export const PLUGIN_PERMISSIONS = [
  'projects.read',
  'jobs.read',
  'jobs.create',
  'jobs.run',
  'runs.read',
  'runs.control',
  'tasks.read',
  'tasks.write',
  'questions.read',
  'questions.answer',
  'completion.read',
  'events.subscribe',
  'github.read',
  'github.write',
  'how-it-works.read'
] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Shown wherever a person approves a plugin (spec §31, design P1): permissions are not a sandbox. */
export const PLUGIN_TRUST_WARNING =
  'Plugins run trusted code on this machine: a plugin can do anything you can, and its permissions limit only what it asks Astera for.'

export interface PluginManifest {
  /** The package name: unique on npm, and what every command names the plugin by (design P3). */
  id: string
  name: string
  displayName: string
  version: string
  description?: string
  apiVersion: string
  /** Relative to the plugin's folder, and never leaving it. */
  entry: string
  capabilities: PluginCapability[]
  permissions: PluginPermission[]
  minAsteraVersion?: string
  /** `astera.settingsSchema`, read (settings.ts); none when the plugin has no settings. */
  settings: SettingField[]
}

/** npm's rule for new names, which also leaves out `~`: on Windows `astera~1` can be another folder's short name. */
const NAME = /^(?:@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/
/** A part of a name Windows will not keep as a folder of its own: a device name (with or without an extension), or one
 *  ending in a dot, which it drops. */
const NOT_A_FOLDER = /^(?:(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?|.*\.)$/
const NAME_MAX = 214
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DISPLAY_NAME_MAX = 64
const DESCRIPTION_MAX = 500
/** Control characters other than a tab (final review m5): the approval message prints the displayName and the
 *  description, where a line feed could fake lines ahead of the permissions and an escape could repaint the terminal. */
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why `name` cannot be a plugin's package name, or null: npm's rule for new names, as one folder on every platform. A
 *  manifest's name and an npm spec's (npmSpec.ts) are read by the same rule. */
export function npmNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name.length > NAME_MAX || !NAME.test(name)) return `name ${JSON.stringify(name ?? null)} is not an npm package name`
  if (name.replace(/^@/, '').split('/').some((part) => NOT_A_FOLDER.test(part))) return `name ${JSON.stringify(name)} cannot be a folder of its own on Windows`
  return null
}

/** A relative path that cannot leave the folder it is read in, on any platform. */
const entryProblem = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.trim() === '') return 'astera.entry is missing: the file Astera starts, relative to the plugin'
  if (/^[\\/]/.test(v) || /^[A-Za-z]:/.test(v)) return `astera.entry ${v} is not relative to the plugin`
  if (v.split(/[\\/]/).includes('..')) return `astera.entry ${v} leaves the plugin`
  return null
}

/** A list of known names without repeats; the problems use the field's own name. */
function namesOf<T extends string>(field: string, v: unknown, known: readonly T[], kind: string, problems: string[]): T[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    problems.push(`${field} is not a list`)
    return []
  }
  const out: T[] = []
  for (const name of v) {
    if (typeof name !== 'string' || !(known as readonly string[]).includes(name)) {
      problems.push(`${field}: ${String(name)} is not a ${kind}; they are ${known.join(', ')}`)
      continue
    }
    if (out.includes(name as T)) {
      problems.push(`${field} names ${name} twice`)
      continue
    }
    out.push(name as T)
  }
  return out
}

/** Every problem with the package, or the manifest it holds. */
export function parseManifest(pkg: unknown): { ok: true; manifest: PluginManifest } | { ok: false; problems: string[] } {
  if (!isObject(pkg)) return { ok: false, problems: ['package.json is not a JSON object'] }
  const problems: string[] = []
  const { name, version, displayName, description, astera } = pkg
  const named = npmNameProblem(name)
  if (named !== null) problems.push(named)
  if (typeof version !== 'string' || !SEMVER.test(version)) problems.push(`version ${JSON.stringify(version ?? null)} is not a semver version`)
  if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim() === '' || displayName.trim().length > DISPLAY_NAME_MAX))
    problems.push(`displayName must be text of 1 to ${DISPLAY_NAME_MAX} characters`)
  else if (typeof displayName === 'string' && CONTROL.test(displayName)) problems.push('displayName holds a control character')
  if (description !== undefined && typeof description !== 'string') problems.push('description must be text')
  else if (typeof description === 'string' && CONTROL.test(description)) problems.push('description holds a control character')
  if (astera === undefined) {
    problems.push('astera is missing: a plugin names its entry and Plugin API there')
    return { ok: false, problems }
  }
  if (!isObject(astera)) {
    problems.push('astera is not an object')
    return { ok: false, problems }
  }
  if (typeof astera.apiVersion !== 'string' || astera.apiVersion === '')
    problems.push(`astera.apiVersion is missing: the Plugin API the plugin is written for (${PLUGIN_API_VERSIONS.join(', ')})`)
  const entry = entryProblem(astera.entry)
  if (entry !== null) problems.push(entry)
  const capabilities = namesOf('astera.capabilities', astera.capabilities, PLUGIN_CAPABILITIES, 'capability', problems)
  const permissions = namesOf('astera.permissions', astera.permissions, PLUGIN_PERMISSIONS, 'permission', problems)
  const min = astera.minAsteraVersion
  if (min !== undefined && (typeof min !== 'string' || !SEMVER.test(min)))
    problems.push(`astera.minAsteraVersion ${JSON.stringify(min)} is not a semver version`)
  const schema = parseSettingsSchema(astera.settingsSchema)
  if (!schema.ok) problems.push(...schema.problems)
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    manifest: {
      id: name as string,
      name: name as string,
      displayName: typeof displayName === 'string' ? displayName.trim() : (name as string),
      version: version as string,
      ...(typeof description === 'string' ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
      apiVersion: astera.apiVersion as string,
      entry: astera.entry as string,
      capabilities,
      permissions,
      ...(typeof min === 'string' ? { minAsteraVersion: min } : {}),
      settings: schema.ok ? schema.fields : []
    }
  }
}

/** The plugin's folder under `<profile>/plugins`: the id with its scope slash written as `+`, which no npm name holds,
 *  so two ids never share a folder (design P3). */
export const pluginFolderName = (id: string): string => id.replace('/', '+')

/** major, minor, patch; a prerelease or build tag is read as its release. Null when it is not a version. */
const release = (v: string): [number, number, number] | null => {
  const m = SEMVER.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Why this Astera will not run the plugin (spec §29, design P8), or null when it will. */
export function incompatibility(m: PluginManifest, host: { version: string; capabilities: readonly string[] }): string | null {
  if (!(PLUGIN_API_VERSIONS as readonly string[]).includes(m.apiVersion))
    return `this Astera speaks Plugin API ${PLUGIN_API_VERSIONS.join(', ')}; the plugin needs ${m.apiVersion}`
  if (m.minAsteraVersion !== undefined) {
    const need = release(m.minAsteraVersion)
    const have = release(host.version)
    const older = need !== null && have !== null && (have[0] - need[0] || have[1] - need[1] || have[2] - need[2]) < 0
    if (older) return `the plugin needs Astera ${m.minAsteraVersion} or newer; this is ${host.version}`
  }
  const missing = m.capabilities.find((c) => !host.capabilities.includes(c))
  if (missing !== undefined) return `this Astera does not run ${missing} plugins yet`
  return null
}
