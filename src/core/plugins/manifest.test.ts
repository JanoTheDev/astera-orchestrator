import { describe, it, expect } from 'vitest'
import {
  PLUGIN_PERMISSIONS,
  PLUGIN_TRUST_WARNING,
  incompatibility,
  parseManifest,
  pluginFolderName,
  type PluginManifest
} from './manifest'

const valid = (astera: Record<string, unknown> = {}, top: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: '@acme/astera-jira',
  version: '1.2.3',
  astera: { apiVersion: '1', entry: './dist/plugin.js', ...astera },
  ...top
})

const problemsOf = (pkg: unknown): string[] => {
  const r = parseManifest(pkg)
  if (r.ok) throw new Error('expected problems')
  return r.problems
}

const manifestOf = (pkg: unknown): PluginManifest => {
  const r = parseManifest(pkg)
  if (!r.ok) throw new Error(r.problems.join('; '))
  return r.manifest
}

describe('parseManifest', () => {
  it('reads a package.json with an astera field, filling the defaults', () => {
    expect(manifestOf(valid())).toEqual({
      id: '@acme/astera-jira',
      name: '@acme/astera-jira',
      displayName: '@acme/astera-jira',
      version: '1.2.3',
      apiVersion: '1',
      entry: './dist/plugin.js',
      capabilities: [],
      permissions: []
    })
  })

  it('keeps what the package gives', () => {
    const m = manifestOf(
      valid(
        { capabilities: ['event'], permissions: ['jobs.read', 'jobs.create'], minAsteraVersion: '1.5.0', settingsSchema: { type: 'object' } },
        { displayName: '  Jira  ', description: 'Jobs from Jira issues' }
      )
    )
    expect(m).toMatchObject({
      displayName: 'Jira',
      description: 'Jobs from Jira issues',
      capabilities: ['event'],
      permissions: ['jobs.read', 'jobs.create'],
      minAsteraVersion: '1.5.0'
    })
  })

  it('cuts a long description to 500 characters', () => {
    expect(manifestOf(valid({}, { description: 'x'.repeat(600) })).description).toHaveLength(500)
  })

  it('refuses something that is not an object', () => {
    expect(problemsOf(null)).toEqual(['package.json is not a JSON object'])
    expect(problemsOf([])).toEqual(['package.json is not a JSON object'])
  })

  it('refuses a name npm would refuse', () => {
    for (const name of ['', 'Jira', 'has space', '@acme/', '../escape', 'a'.repeat(215), 7])
      expect(problemsOf(valid({}, { name }))).toEqual([expect.stringMatching(/^name /)])
  })

  // Final review m1: on Windows `astera~1` can be another folder's short name, `nul` is a device, and a trailing dot is
  // dropped; npm itself refuses `~` in new names.
  it('refuses a name that would not be its own folder on every system', () => {
    for (const name of ['astera~1', '~x', '@acme/x~1', 'nul', 'con', 'aux.js', 'com1', 'lpt9.x', '@nul/x', 'foo.', '@acme./x'])
      expect(problemsOf(valid({}, { name })), name).toEqual([expect.stringMatching(/^name /)])
    for (const name of ['nullable', 'console', 'auxiliary', 'com', 'lpt10', 'a.b', '@acme/con-tools'])
      expect(manifestOf(valid({}, { name })).id, name).toBe(name)
  })

  it('refuses a version that is not semver', () => {
    for (const version of ['1.2', 'v1.2.3', '', 1])
      expect(problemsOf(valid({}, { version }))).toEqual([expect.stringMatching(/^version /)])
    expect(manifestOf(valid({}, { version: '1.2.3-beta.1+build.5' })).version).toBe('1.2.3-beta.1+build.5')
  })

  it('refuses a displayName that is empty or longer than 64 characters', () => {
    expect(problemsOf(valid({}, { displayName: '   ' }))).toEqual([expect.stringMatching(/^displayName /)])
    expect(problemsOf(valid({}, { displayName: 'x'.repeat(65) }))).toEqual([expect.stringMatching(/^displayName /)])
    expect(problemsOf(valid({}, { displayName: 3 }))).toEqual([expect.stringMatching(/^displayName /)])
  })

  // Final review m5: both are printed in the approval message, where a line feed could fake lines ahead of the
  // permissions, and an escape could repaint the terminal.
  it('refuses control characters in the displayName and the description', () => {
    const lf = String.fromCharCode(10)
    const esc = String.fromCharCode(27)
    const del = String.fromCharCode(127)
    const c1 = String.fromCharCode(155)
    expect(problemsOf(valid({}, { displayName: `Jira${lf}asks for: nothing` }))).toEqual([expect.stringMatching(/^displayName /)])
    expect(problemsOf(valid({}, { displayName: `Jira${del}` }))).toEqual([expect.stringMatching(/^displayName /)])
    expect(problemsOf(valid({}, { description: `${esc}[2J` }))).toEqual([expect.stringMatching(/^description /)])
    expect(problemsOf(valid({}, { description: `x${c1}y` }))).toEqual([expect.stringMatching(/^description /)])
    expect(manifestOf(valid({}, { displayName: 'Jira 연동', description: 'Tabs	and Hangul 한글' })).displayName).toBe('Jira 연동')
  })

  it('refuses a description that is not a string', () => {
    expect(problemsOf(valid({}, { description: 3 }))).toEqual([expect.stringMatching(/^description /)])
  })

  it('needs an astera object', () => {
    expect(problemsOf({ name: 'x', version: '1.0.0' })).toEqual(['astera is missing: a plugin names its entry and Plugin API there'])
    expect(problemsOf({ name: 'x', version: '1.0.0', astera: [] })).toEqual([expect.stringMatching(/^astera /)])
  })

  it('needs an apiVersion', () => {
    expect(problemsOf(valid({ apiVersion: undefined }))).toEqual([expect.stringMatching(/^astera\.apiVersion /)])
    expect(problemsOf(valid({ apiVersion: 1 }))).toEqual([expect.stringMatching(/^astera\.apiVersion /)])
  })

  it('needs an entry that stays inside the plugin', () => {
    for (const entry of [undefined, '', '../x.js', 'dist/../../x.js', '/abs.js', '\\abs.js', 'C:/x.js', 'c:x.js', 'dist\\..\\..\\x.js'])
      expect(problemsOf(valid({ entry })), String(entry)).toEqual([expect.stringMatching(/^astera\.entry /)])
    expect(manifestOf(valid({ entry: 'plugin.mjs' })).entry).toBe('plugin.mjs')
  })

  it('refuses an unknown capability and a repeated one', () => {
    expect(problemsOf(valid({ capabilities: ['events'] }))).toEqual([
      'astera.capabilities: events is not a capability; they are event, job-source, completion-check, notification'
    ])
    expect(problemsOf(valid({ capabilities: ['event', 'event'] }))).toEqual(['astera.capabilities names event twice'])
    expect(problemsOf(valid({ capabilities: 'event' }))).toEqual(['astera.capabilities is not a list'])
  })

  it('refuses an unknown permission, naming the known ones, and a repeated one', () => {
    expect(problemsOf(valid({ permissions: ['jobs.write'] }))).toEqual([
      `astera.permissions: jobs.write is not a permission; they are ${PLUGIN_PERMISSIONS.join(', ')}`
    ])
    expect(problemsOf(valid({ permissions: ['jobs.read', 'jobs.read'] }))).toEqual(['astera.permissions names jobs.read twice'])
    expect(problemsOf(valid({ permissions: [3] }))).toEqual([expect.stringMatching(/^astera\.permissions: 3 is not a permission/)])
  })

  it('refuses a minAsteraVersion that is not semver', () => {
    expect(problemsOf(valid({ minAsteraVersion: '1.5' }))).toEqual([expect.stringMatching(/^astera\.minAsteraVersion /)])
  })

  it('lists every problem at once', () => {
    expect(problemsOf({ name: 'Bad Name', version: 'x', astera: { entry: '../x', permissions: ['nope'] } })).toHaveLength(5)
  })
})

describe('the permission vocabulary', () => {
  it('is the design table, fifteen names', () => {
    expect([...PLUGIN_PERMISSIONS]).toEqual([
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
    ])
  })
})

describe('pluginFolderName', () => {
  it('writes the scope slash as +, which no npm name holds', () => {
    expect(pluginFolderName('@acme/astera-jira')).toBe('@acme+astera-jira')
    expect(pluginFolderName('astera-webhook')).toBe('astera-webhook')
  })
})

describe('incompatibility', () => {
  const host = { version: '1.5.0', capabilities: [] as string[] }
  it('is null for a plugin this Astera runs', () => {
    expect(incompatibility(manifestOf(valid()), host)).toBeNull()
    expect(incompatibility(manifestOf(valid({ minAsteraVersion: '1.5.0' })), host)).toBeNull()
    expect(incompatibility(manifestOf(valid({ minAsteraVersion: '1.4.99' })), host)).toBeNull()
  })
  it('names a Plugin API this Astera does not speak', () => {
    expect(incompatibility(manifestOf(valid({ apiVersion: '2' })), host)).toBe('this Astera speaks Plugin API 1; the plugin needs 2')
  })
  it('names a newer Astera the plugin needs', () => {
    expect(incompatibility(manifestOf(valid({ minAsteraVersion: '1.10.0' })), host)).toBe(
      'the plugin needs Astera 1.10.0 or newer; this is 1.5.0'
    )
  })
  it('reads a prerelease Astera as its release numbers', () => {
    expect(incompatibility(manifestOf(valid({ minAsteraVersion: '1.5.0' })), { ...host, version: '1.5.0-beta.1' })).toBeNull()
  })
  it('names a capability this Astera does not run yet', () => {
    expect(incompatibility(manifestOf(valid({ capabilities: ['event', 'job-source'] })), { ...host, capabilities: ['event'] })).toBe(
      'this Astera does not run job-source plugins yet'
    )
  })
})

describe('PLUGIN_TRUST_WARNING', () => {
  it('says plainly that a plugin is not a sandbox', () => {
    expect(PLUGIN_TRUST_WARNING).toBe(
      'Plugins run trusted code on this machine: a plugin can do anything you can, and its permissions limit only what it asks Astera for.'
    )
  })
})
