// W9-E: General (DESIGN §7) — language, default session kind, auto-close (the old general tab), theme and console font
// (appearance), shortcuts. The JSX is the settings modal's, moved unchanged.
import type { SessionKind } from '../../../../core/types'
import type { Lang, MessageKey } from '../../../../core/i18n'
import { CATALOGS, LANGS } from '../../../../core/i18n'
import { useState } from 'react'
import { Button, Icon, Input, Kbd, Select, Switch } from '../ui'
import { setOnboardingReplay } from '../onboarding/replay'
import { ShortcutSettings, shortcutRows } from '../ShortcutSettings'
import { resolveBindings } from '../../../../core/keys/binding'
import { ACTIONS } from '../../lib/actions'
import { TerminalFontSettings } from '../TerminalFontSettings'
import { ThemeSettings } from '../ThemeSettings'
import { AutoCloseTabsSetting } from '../AutoCloseTabsSetting'
import { toast } from '../../lib/toast'
import { deleteKey, isMac as isMacPlatform, modKey } from '../../lib/platformKeys'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import { SettingRow, type GroupProps } from './SettingRow'
import { SettingItem } from './SettingItem'

// The shortcut list for the settings modal. When a binding changes (the TerminalView key handler or
// the global listener in App), update this list along with it.
// group and desc are kept as MessageKeys and translated with t() at render time (the shortcuts tab of
// the settings modal) — this array is a module-level constant, so t() cannot be called here.
// keys are literal keyboard combinations (e.g. 'Ctrl+C') and are not translated. Two entries are mouse
// gestures rather than key combinations, though, and leaving them as-is would strand text in the
// wrong language — those two clear keys and render a translated label from gestureKey (a MessageKey)
// inside the <kbd> instead.
// Most of the Ctrl-labelled entries below are actually platform-dependent: terminal copy/paste,
// explorer save/select-all/cut/copy/paste/undo are all Cmd on macOS (see MOD below), so they are
// built with MOD rather than a literal 'Ctrl'. The one deliberate exception is 'Ctrl+Enter' (terminal
// newline) — TerminalView.tsx leaves that one alone on both platforms because Claude Code reads
// Ctrl+Enter as a newline regardless of OS. F2 is unchanged across platforms; delete is Cmd+Backspace
// on macOS, whose keyboard has no forward Delete without fn (lib/platformKeys.ts).
const MOD = modKey()
const SHORTCUTS: Array<{
  group: MessageKey
  items: Array<{ keys: string[]; desc: MessageKey; gestureKey?: MessageKey }>
}> = [
  {
    group: 'shortcut.group.terminal',
    items: [
      { keys: ['Ctrl+Enter'], desc: 'shortcut.terminal.newline' },
      { keys: [`${MOD}+C`], desc: 'shortcut.terminal.copyOrInterrupt' },
      { keys: [`${MOD}+V`], desc: 'shortcut.paste' }
    ]
  },
  {
    group: 'shortcut.group.sessionTab',
    items: [
      {
        keys: [],
        gestureKey: 'shortcut.gesture.tabDrag',
        desc: 'shortcut.sessionTab.reorder'
      }
    ]
  },
  {
    group: 'shortcut.group.pane',
    items: [
      {
        keys: [],
        gestureKey: 'shortcut.gesture.tabDrag',
        desc: 'shortcut.pane.dragSplit'
      }
    ]
  },
  {
    group: 'shortcut.group.explorer',
    items: [
      { keys: [`${MOD}+S`], desc: 'shortcut.explorer.saveFile' },
      { keys: ['F2'], desc: 'shortcut.explorer.rename' },
      {
        keys: [isMacPlatform() ? deleteKey() : 'Delete'],
        desc: 'shortcut.explorer.delete'
      },
      { keys: [`${MOD}+A`], desc: 'shortcut.explorer.selectAll' },
      { keys: [`${MOD}+X`], desc: 'shortcut.explorer.cut' },
      { keys: [`${MOD}+C`], desc: 'shortcut.explorer.copy' },
      { keys: [`${MOD}+V`], desc: 'shortcut.paste' },
      {
        keys: [],
        gestureKey: 'shortcut.gesture.itemDrag',
        desc: 'shortcut.explorer.move'
      },
      { keys: [`${MOD}+Z`], desc: 'shortcut.explorer.undo' }
    ]
  }
]

/** The value the "System" row carries. Empty string, because Select keys rows by string and null is
 *  not one — it is mapped back to null on the way out. Same convention as TerminalFontSettings. */
const SYSTEM_LANG = ''

export function GeneralSettings(p: GroupProps): React.JSX.Element | null {
  const {
    shown,
    only,
    autoCloseEndedPlanTabs,
    defaultSessionKind,
    keyOverrides,
    setAutoCloseEndedPlanTabs,
    setDefaultSessionKind,
    setKeyOverrides,
    setLang,
    settingsTouched,
    storedLang,
    systemLang,
    t
  } = p
  const [advanced, setAdvanced] = useAdvancedMode()
  if (!shown) return null
  return (
    <>
      {/* .settings-stack 은 '기능 하나 = 굵은 제목 + 바로 아래 설명' 으로 읽히게 하는
          배치다. 일반·에이전트·How It Works 세 탭이 같이 쓴다 — 셋 다 토글과 설명이
          번갈아 오는 모양이라서다. 제목과 설명은 .settings-group 으로 붙인다. */}
      <div className="settings-stack">
        <SettingRow a="language" only={only} modified={storedLang !== null}>
          {/* Each language is written in its own language, so it can be found without knowing the current one.
              Not a translation target. */}
          <SettingItem
            title={t('settings.general.language')}
            control={
              <Select
                            className="settings-lang-select"
                            value={storedLang ?? SYSTEM_LANG}
                            onChange={(v) => setLang(v === SYSTEM_LANG ? null : (v as Lang))}
                            ariaLabel={t('settings.general.language')}
                            items={[
                              { value: SYSTEM_LANG, label: t('settings.general.language.system', { lang: CATALOGS[systemLang].nativeName }) },
                              ...LANGS.map((l) => ({ value: l, label: CATALOGS[l].nativeName }))
                            ]}
                          />
            }
          />
        </SettingRow>
        <SettingRow a="advancedMode" only={only} modified={advanced}>
          <SettingItem title={t('settings.basic.advancedMode.label')} hint={t('settings.basic.advancedMode.hint')} control={<Switch aria-label={t('settings.basic.advancedMode.label')} checked={advanced} onChange={setAdvanced} />} />
        </SettingRow>
        {/* Which kind the two session dialogs open on. A plain enum with nothing coupled
            to it, so — unlike the resume-strategy pair below, which earns its own
            component exactly because setting one can flip the other — a settings-row
            beside the language row is all this needs. It seeds each dialog's own
            selection and nothing else: picking the other kind inside the dialog belongs
            to that session and is not written back here. */}
        <SettingRow a="defaultKind" only={only} modified={defaultSessionKind !== 'terminal'}>
          <SettingItem
            title={t('settings.defaultKind.title')}
            hint={t('settings.defaultKind.hint')}
            control={
              <Select
                value={defaultSessionKind}
                ariaLabel={t('settings.defaultKind.title')}
                items={[
                  { value: 'terminal', label: t('settings.defaultKind.terminal') },
                  { value: 'chat', label: t('settings.defaultKind.chat') }
                ]}
                onChange={(v) => {
                  const next = v as SessionKind
                  const prev = defaultSessionKind
                  settingsTouched.current.touch('defaultKind')
                  setDefaultSessionKind(next) // an optimistic update — reverted below on failure
                  void window.api.settings.setDefaultSessionKind(next).catch((err) => {
                    setDefaultSessionKind(prev)
                    toast.error(
                      t('settings.defaultKind.saveFailed', {
                        detail: err instanceof Error ? err.message : String(err)
                      })
                    )
                  })
                }}
              />
            }
          />
        </SettingRow>
        {/* W7-F (#84): an ended plan's tabs close on their own */}
        <SettingRow a="autoCloseTabs" only={only} modified={!autoCloseEndedPlanTabs}>
          <AutoCloseTabsSetting on={autoCloseEndedPlanTabs} onChange={setAutoCloseEndedPlanTabs} />
        </SettingRow>
        {/* The first-run onboarding again, from Welcome. It only walks through setup; no setting is reset. */}
        <SettingRow a="onboarding" only={only}>
          <SettingItem title={t('onboarding.settings.replay')} hint={t('onboarding.settings.replayHint')} control={
            <Button
                size="sm"
                onClick={() => {
                  setOnboardingReplay(true)
                  p.setShowSettings(false)
                }}
              >
                {t('onboarding.settings.replayButton')}
              </Button>
          } />
        </SettingRow>
      </div>
      <SettingRow a="theme" only={only}>
        <ThemeSettings />
      </SettingRow>
      <SettingRow a="terminalFont" only={only}>
        <TerminalFontSettings />
      </SettingRow>
      <SettingRow a="shortcuts" only={only}>
        <ShortcutTable keyOverrides={keyOverrides} setKeyOverrides={setKeyOverrides} t={t} />
      </SettingRow>
    </>
  )
}

/** W11 (DESIGN-W11 §9): every shortcut in one searchable table, the chord right beside its name. The editable ones
 *  come from ShortcutSettings, the fixed ones from SHORTCUTS. */
function ShortcutTable({
  keyOverrides,
  setKeyOverrides,
  t
}: Pick<GroupProps, 'keyOverrides' | 'setKeyOverrides' | 't'>): React.JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLocaleLowerCase()
  const matches = (name: string, keys: string[]): boolean =>
    !q || name.toLocaleLowerCase().includes(q) || keys.some((k) => k.toLocaleLowerCase().includes(q))
  const fixed = SHORTCUTS.map((g) => ({
    group: g.group,
    items: g.items.filter((it) => matches(t(it.desc, { mod: MOD }), it.gestureKey ? [t(it.gestureKey)] : it.keys))
  })).filter((g) => g.items.length > 0)
  const anyEditable = shortcutRows(resolveBindings(keyOverrides, ACTIONS), t).some((r) => matches(r.name, r.keys))
  return (
    <>
      <div className="settings-card-head">
        <h3 className="settings-card-title">{t('settings.tab.shortcuts')}</h3>
        <label className="settings-page__search shortcut-search">
          <Icon name="search" size={14} />
          <Input
            type="search"
            value={query}
            placeholder={t('settings.shortcuts.search')}
            aria-label={t('settings.shortcuts.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears this search first, and only an empty one lets the page close.
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
        </label>
      </div>
      <table className="shortcut-table">
        <thead>
          <tr>
            <th scope="col">{t('settings.shortcuts.action')}</th>
            <th scope="col">{t('settings.shortcuts.keys')}</th>
            <th scope="col" aria-hidden="true" />
          </tr>
        </thead>
        <ShortcutSettings overrides={keyOverrides} onChanged={setKeyOverrides} matches={matches} />
        {fixed.map((g) => (
          <tbody key={g.group}>
            <tr className="shortcut-table__group">
              <th colSpan={3} scope="colgroup">
                {t(g.group)}
              </th>
            </tr>
            {g.items.map((it) => (
              <tr key={it.desc}>
                <td>{t(it.desc, { mod: MOD })}</td>
                <td>
                  <span className="shortcut-table__keys">
                    {it.gestureKey ? (
                      <span className="shortcut-table__state">{t(it.gestureKey)}</span>
                    ) : (
                      it.keys.map((k, i) => (
                        <span key={k} className="shortcut-table__keys">
                          {i > 0 && <span className="shortcut-table__state">{t('common.or')}</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))
                    )}
                  </span>
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {!anyEditable && fixed.length === 0 && (
        <p className="settings-hint">{t('settings.shortcuts.empty', { query: query.trim() })}</p>
      )}
    </>
  )
}
