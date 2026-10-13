import { describe, it, expect } from 'vitest'
import { t as translate, type MessageKey, type MessageParams } from '../../../core/i18n'
import { PLUGIN_TRUST_WARNING } from '../../../core/plugins/manifest'
import type { SettingField } from '../../../core/plugins/settings'
import { configureChanges, configureDoneLine, failureLine, installPrompt, permissionLabel, reasonLine, statusLabel } from './pluginsText'

const en = (key: MessageKey, params?: MessageParams): string => translate('en', key, params)
const ko = (key: MessageKey, params?: MessageParams): string => translate('ko', key, params)
const lf = String.fromCharCode(10)

const INSPECTION = {
  id: '@acme/astera-jira',
  name: '@acme/astera-jira',
  displayName: 'Jira',
  version: '1.0.0',
  apiVersion: '1',
  entry: './dist/plugin.js',
  capabilities: [],
  permissions: ['jobs.read', 'jobs.create'],
  compatible: true
}

describe('permissionLabel and statusLabel', () => {
  it('names each permission of the vocabulary in words, and an unknown one by its name', () => {
    expect(permissionLabel('jobs.read', en)).toBe('Read Jobs')
    expect(permissionLabel('jobs.create', en)).toBe('Create Jobs')
    expect(permissionLabel('events.subscribe', en)).toBe('Subscribe to events')
    expect(permissionLabel('network.raw', en)).toBe('network.raw')
    for (const p of ['projects.read', 'jobs.read', 'jobs.create', 'jobs.run', 'runs.read', 'runs.control', 'tasks.read', 'tasks.write', 'questions.read', 'questions.answer', 'completion.read', 'events.subscribe', 'github.read', 'github.write', 'how-it-works.read'])
      expect(permissionLabel(p, ko), p).not.toBe(p)
  })

  it('names each status, and an unknown one by itself', () => {
    expect(['running', 'starting', 'stopped', 'failed', 'disabled', 'incompatible'].map((s) => statusLabel(s, en))).toEqual([
      'Running',
      'Starting',
      'Stopped',
      'Failed',
      'Disabled',
      'Incompatible'
    ])
    expect(statusLabel('paused', en)).toBe('paused')
  })
})

describe('installPrompt (spec §31)', () => {
  it('asks for each permission, all checked, and ends with the trust sentence', () => {
    const p = installPrompt(INSPECTION, 'D:/work/jira 플러그인', en)
    expect(p.title).toBe('Jira plugin requests:')
    expect(p.choices).toEqual([
      { id: 'jobs.read', label: 'Read Jobs', hint: 'jobs.read', defaultChecked: true },
      { id: 'jobs.create', label: 'Create Jobs', hint: 'jobs.create', defaultChecked: true }
    ])
    expect(p.body.split(lf)).toEqual([
      '@acme/astera-jira, version 1.0.0',
      'From D:/work/jira 플러그인',
      'A permission you uncheck is not granted.',
      '',
      PLUGIN_TRUST_WARNING
    ])
    expect(p.confirmLabel).toBe('Install')
  })

  it('says what it replaces, what it does, why it will not run, what it serves, and that it asks for nothing', () => {
    const p = installPrompt(
      {
        ...INSPECTION,
        description: 'Turns Jira issues into Jobs',
        capabilities: ['job-source'],
        permissions: [],
        compatible: false,
        reason: 'this Astera does not serve job-source plugins yet',
        installed: { version: '0.9.0', enabled: true }
      },
      'D:/work/jira',
      en
    )
    expect(p.choices).toEqual([])
    expect(p.body.split(lf)).toEqual([
      '@acme/astera-jira, version 1.0.0',
      'From D:/work/jira',
      'It replaces the installed version 0.9.0.',
      'Turns Jira issues into Jobs',
      'Capabilities: job-source',
      'It will not run on this Astera: this Astera does not serve job-source plugins yet',
      'It asks for no permissions.',
      '',
      PLUGIN_TRUST_WARNING
    ])
  })

  it('reads in Korean too', () => {
    expect(installPrompt(INSPECTION, 'D:/x', ko).body).toContain('신뢰된 코드')
  })
})

describe('configureChanges (spec §23, §24)', () => {
  const fields: SettingField[] = [
    { key: 'baseUrl', type: 'string', required: true },
    { key: 'pageSize', type: 'integer', default: 50, enum: [25, 50, 100], required: false },
    { key: 'ratio', type: 'number', required: false },
    { key: 'dryRun', type: 'boolean', default: false, required: false },
    { key: 'token', type: 'string', secret: true, required: true },
    { key: 'spare', type: 'string', secret: true, required: false }
  ]
  const shown = { values: { baseUrl: 'https://a.example.com', pageSize: 50, ratio: 1.5, dryRun: false }, secrets: { token: 'set', spare: 'unset' } }

  it('is nothing when nothing was touched, or touched back to what it was', () => {
    expect(configureChanges(fields, shown, {}, new Set())).toBeNull()
    expect(configureChanges(fields, shown, { baseUrl: 'https://a.example.com', pageSize: '50', dryRun: false }, new Set())).toBeNull()
  })

  it('sets what changed, as typed, and a boolean as a boolean', () => {
    expect(configureChanges(fields, shown, { baseUrl: 'https://b.example.com', pageSize: '100', ratio: '2.5', dryRun: true }, new Set())).toEqual({
      set: { baseUrl: 'https://b.example.com', pageSize: '100', ratio: '2.5', dryRun: true },
      unset: []
    })
  })

  it('unsets an emptied field, unless what it showed was its default', () => {
    expect(configureChanges(fields, shown, { ratio: '' }, new Set())).toEqual({ set: {}, unset: ['ratio'] })
    expect(configureChanges(fields, shown, { pageSize: '' }, new Set())).toBeNull()
  })

  it('leaves a secret alone when its box is empty, sets it when typed in, and unsets it only when cleared', () => {
    expect(configureChanges(fields, shown, { token: '' }, new Set())).toBeNull()
    expect(configureChanges(fields, shown, { token: 'tok-2' }, new Set())).toEqual({ set: { token: 'tok-2' }, unset: [] })
    expect(configureChanges(fields, shown, {}, new Set(['token']))).toEqual({ set: {}, unset: ['token'] })
    expect(configureChanges(fields, shown, {}, new Set(['spare']))).toBeNull()
  })
})

describe('configureDoneLine', () => {
  it('says how the plugin stands after a save', () => {
    expect(configureDoneLine({ status: 'running', restarted: true }, en)).toBe('Saved. The plugin was restarted.')
    expect(configureDoneLine({ status: 'starting' }, en)).toBe('Saved. The plugin is starting.')
    expect(configureDoneLine({ status: 'stopped', reason: 'needs settings: token' }, en)).toBe('Saved. It does not run yet: needs settings: token')
    expect(configureDoneLine({ status: 'failed', reason: 'activate threw: x' }, en)).toBe('Saved. It failed before, and starts again only when you press Start again.')
    expect(configureDoneLine({ status: 'disabled' }, en)).toBe('Saved. It is disabled, and starts with these values when you enable it.')
    expect(configureDoneLine({ status: 'stopped' }, en)).toBe('Saved.')
  })
})

// Found on the dev app: the Host's reason for a held-back plugin points at the CLI, in English, beside a Configure button.
describe('reasonLine', () => {
  it('says which settings a held-back plugin needs, in the app’s words', () => {
    expect(reasonLine('needs settings: baseUrl, token; set them with astera plugins configure --id @acme/jira', en)).toBe(
      'Needs settings: baseUrl, token. Set them with Configure.'
    )
  })

  it('gives any other reason as the Host said it', () => {
    expect(reasonLine('activate threw: 401 for [redacted] (3 times in a row, each within 30 s of starting)', en)).toBe(
      'activate threw: 401 for [redacted] (3 times in a row, each within 30 s of starting)'
    )
    expect(reasonLine('', en)).toBe('')
  })
})

describe('failureLine', () => {
  it('says in the app’s words that no Host is there, that it runs no plugins, or that it did not answer', () => {
    expect(failureLine({ ok: false, code: 'HOST_NOT_RUNNING', message: 'x' }, en)).toBe('The app is not connected to the Host.')
    expect(failureLine({ ok: false, code: 'NOT_SUPPORTED', message: 'unknown command: plugins-list' }, en)).toBe(
      'The running Host does not support plugins (unknown command: plugins-list). Update Astera and restart the Host.'
    )
    expect(failureLine({ ok: false, code: 'TIMEOUT', message: 'x' }, en)).toBe('The Host did not answer in time. The list shows whether it was done.')
    expect(failureLine({ ok: false, code: 'HOST_LOST', message: 'x' }, en)).toBe('The connection to the Host closed. The list shows whether it was done.')
  })

  it('gives the Host’s own sentence otherwise', () => {
    expect(failureLine({ ok: false, code: 'CONFLICT', message: 'D:/x changed since it was shown' }, en)).toBe('D:/x changed since it was shown')
  })
})
