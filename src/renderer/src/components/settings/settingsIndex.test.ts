import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { en } from '../../../../core/i18n/messages/en'
import type { MessageKey } from '../../../../core/i18n'
import {
  OLD_SETTINGS_TABS, SETTINGS_GROUPS, SETTINGS_ROWS, filterSettings, groupHasBasic, groupsShown, groupOfOldTab, rowVisible, settingsTarget, type SettingsRow
} from './settingsIndex'

const t = (k: MessageKey): string => en[k]
const rows: SettingsRow[] = [
  { anchor: 'a', group: 'general', labelKey: 'settings.theme.label', descKey: 'settings.theme.hint', level: 'basic' },
  { anchor: 'b', group: 'agents', labelKey: 'settings.maxWorkers.label', level: 'advanced' },
  { anchor: 'c', group: 'advanced', labelKey: 'settings.info.version', level: 'advanced' }
]

describe('filterSettings', () => {
  it('an empty or blank query is every row', () => {
    expect(filterSettings(rows, '', t)).toEqual(rows)
    expect(filterSettings(rows, '   ', t)).toEqual(rows)
  })
  it('matches the label, case-insensitively, and keeps the group', () => {
    expect(filterSettings(rows, 'MAX AGENTS', t)).toEqual([rows[1]])
    expect(filterSettings(rows, 'max agents', t)[0].group).toBe('agents')
  })
  it('matches the description', () => {
    const hint = en['settings.theme.hint'].slice(2, 12).toUpperCase()
    expect(filterSettings(rows, hint, t).map((r) => r.anchor)).toEqual(['a'])
  })
  it('finds nothing for a query no row carries', () => {
    expect(filterSettings(rows, 'zzzz-no-such-setting', t)).toEqual([])
  })
  it('every index row has a translated label, and subagents per tab is found under Accounts & usage', () => {
    for (const r of SETTINGS_ROWS) expect(t(r.labelKey), r.anchor).toBeTruthy()
    expect(filterSettings(SETTINGS_ROWS, 'subagents', t).map((r) => r.group)).toEqual(['accounts'])
  })
})

describe('basic and advanced rows', () => {
  it('every row is marked basic or advanced', () => {
    for (const r of SETTINGS_ROWS) expect(['basic', 'advanced'], r.anchor).toContain(r.level)
  })
  it('simple view shows exactly the basic rows', () => {
    const shown = SETTINGS_ROWS.filter((r) => rowVisible(r.anchor, false, null)).map((r) => r.anchor)
    expect(shown.sort()).toEqual([
      'accounts', 'advancedMode', 'appName', 'buildVersion', 'crashReports', 'language', 'license', 'licenses', 'notifications', 'onboarding',
      'projects', 'remote', 'theme', 'update', 'updateChannel', 'version'
    ])
    expect(SETTINGS_ROWS.every((r) => rowVisible(r.anchor, true, null))).toBe(true)
  })
  it('a search shows its advanced hit even in simple mode, and only its hits', () => {
    const hits = new Set(filterSettings(SETTINGS_ROWS, 'worktree', t).map((r) => r.anchor))
    expect(hits.has('worktreeRoot')).toBe(true)
    expect(rowVisible('worktreeRoot', false, hits)).toBe(true)
    expect(rowVisible('language', false, hits)).toBe(false)
  })
  it('the groups with no basic row leave the nav in simple mode', () => {
    expect(SETTINGS_GROUPS.filter((g) => !groupHasBasic(g))).toEqual(['agents', 'advanced'])
  })
})

describe('About group', () => {
  it('is last, and holds the info rows that moved from Advanced, each found by search', () => {
    expect(SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1]).toBe('about')
    for (const anchor of ['appName', 'version', 'cliVersions', 'host', 'accountsCount', 'update']) {
      expect(SETTINGS_ROWS.find((r) => r.anchor === anchor)?.group, anchor).toBe('about')
    }
    expect(filterSettings(SETTINGS_ROWS, 'open source', t).map((r) => r.anchor)).toEqual(['licenses'])
    expect(filterSettings(SETTINGS_ROWS, 'build version', t).map((r) => r.anchor)).toContain('buildVersion')
    expect(groupOfOldTab('info')).toEqual({ group: 'about', anchor: 'appName' })
  })
})

describe('old settings tabs', () => {
  it('lists all 16 tabs of the old modal', () => {
    expect(OLD_SETTINGS_TABS).toHaveLength(16)
  })
  it('every old tab maps to a group and an anchor the index has in that group', () => {
    for (const tab of OLD_SETTINGS_TABS) {
      const { group, anchor } = groupOfOldTab(tab)
      expect(SETTINGS_GROUPS, tab).toContain(group)
      expect(SETTINGS_ROWS.find((r) => r.anchor === anchor)?.group, tab).toBe(group)
    }
  })
  it('settingsTarget passes a group through and maps an old name, keeping a given anchor', () => {
    expect(settingsTarget('integrations', 'cli')).toEqual({ group: 'integrations', anchor: 'cli' })
    expect(settingsTarget('agents')).toEqual({ group: 'agents', anchor: null })
    expect(settingsTarget('worktree')).toEqual({ group: 'advanced', anchor: 'worktreeRoot' })
    expect(settingsTarget('hiw', 'generator')).toEqual({ group: 'advanced', anchor: 'generator' })
  })
})

describe('the page and the index agree', () => {
  const here = __dirname
  const src = readdirSync(here)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(path.join(here, f), 'utf8'))
    .join('\n')
  const rendered = [...src.matchAll(/<SettingRow a="([A-Za-z]+)"/g)].map((m) => m[1])
  it('every index row is rendered once, and every rendered row is in the index', () => {
    expect([...rendered].sort()).toEqual(SETTINGS_ROWS.map((r) => r.anchor).sort())
  })
  it('Slack stays mounted while Settings is open (final review M-6)', () => {
    expect(src).toMatch(/<SettingRow a="slack" only=\{only\} keep hidden=\{!shown\}>\s*<SlackSettings \/>/)
    expect(src).toContain('Kept while Settings is open')
  })
})

describe('groupsShown', () => {
  it('lists the groups with a visible row: simple mode drops agents and advanced', () => {
    expect([...groupsShown(false, null)].sort()).toEqual(SETTINGS_GROUPS.filter((g) => groupHasBasic(g)).sort())
    expect(groupsShown(true, null).size).toBe(SETTINGS_GROUPS.length)
  })
  it('a search lists only the groups of its hits, advanced ones included', () => {
    const only = new Set(filterSettings(SETTINGS_ROWS, 'worktree', t).map((r) => r.anchor))
    expect([...groupsShown(false, only)].sort()).toEqual([...new Set(SETTINGS_ROWS.filter((r) => only.has(r.anchor)).map((r) => r.group))].sort())
    expect(groupsShown(false, new Set()).size).toBe(0)
  })
  it('an anchor resolves to the group that holds it', () => {
    for (const r of SETTINGS_ROWS) expect(groupsShown(true, new Set([r.anchor])).has(r.group), r.anchor).toBe(true)
  })
})
