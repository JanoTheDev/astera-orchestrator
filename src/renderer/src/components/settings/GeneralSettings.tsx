// W9-E: General (DESIGN §7) — language, default session kind, auto-close (the old general tab), theme and console font
// (appearance), shortcuts. The JSX is the settings modal's, moved unchanged.
import type { SessionKind } from '../../../../core/types'
import type { Lang, MessageKey } from '../../../../core/i18n'
import { CATALOGS, LANGS } from '../../../../core/i18n'
import { Select } from '../Select'
import { ShortcutSettings } from '../ShortcutSettings'
import { TerminalFontSettings } from '../TerminalFontSettings'
import { ThemeSettings } from '../ThemeSettings'
import { AutoCloseTabsSetting } from '../AutoCloseTabsSetting'
import { toast } from '../../lib/toast'
import { deleteKey, isMac as isMacPlatform, modKey } from '../../lib/platformKeys'
import { SettingRow, type GroupProps } from './SettingRow'

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
      { keys: [], gestureKey: 'shortcut.gesture.tabDrag', desc: 'shortcut.sessionTab.reorder' }
    ]
  },
  {
    group: 'shortcut.group.pane',
    items: [
      { keys: [], gestureKey: 'shortcut.gesture.tabDrag', desc: 'shortcut.pane.dragSplit' }
    ]
  },
  {
    group: 'shortcut.group.explorer',
    items: [
      { keys: [`${MOD}+S`], desc: 'shortcut.explorer.saveFile' },
      { keys: ['F2'], desc: 'shortcut.explorer.rename' },
      { keys: [isMacPlatform() ? deleteKey() : 'Delete'], desc: 'shortcut.explorer.delete' },
      { keys: [`${MOD}+A`], desc: 'shortcut.explorer.selectAll' },
      { keys: [`${MOD}+X`], desc: 'shortcut.explorer.cut' },
      { keys: [`${MOD}+C`], desc: 'shortcut.explorer.copy' },
      { keys: [`${MOD}+V`], desc: 'shortcut.paste' },
      { keys: [], gestureKey: 'shortcut.gesture.itemDrag', desc: 'shortcut.explorer.move' },
      { keys: [`${MOD}+Z`], desc: 'shortcut.explorer.undo' }
    ]
  }
]

/** The value the "System" row carries. Empty string, because Select keys rows by string and null is
 *  not one — it is mapped back to null on the way out. Same convention as TerminalFontSettings. */
const SYSTEM_LANG = ''

export function GeneralSettings(p: GroupProps): React.JSX.Element | null {
  const {
    shown, only, autoCloseEndedPlanTabs, defaultSessionKind, keyOverrides, setAutoCloseEndedPlanTabs, setDefaultSessionKind,
    setKeyOverrides, setLang, settingsTouched, storedLang, systemLang, t
  } = p
  if (!shown) return null
  return (
    <>
      {/* .settings-stack 은 '기능 하나 = 굵은 제목 + 바로 아래 설명' 으로 읽히게 하는
          배치다. 일반·에이전트·How It Works 세 탭이 같이 쓴다 — 셋 다 토글과 설명이
          번갈아 오는 모양이라서다. 제목과 설명은 .settings-group 으로 붙인다. */}
      <div className="settings-stack">
        <SettingRow a="language" only={only}>
          <div className="settings-row">
            <span>{t('settings.general.language')}</span>
            <Select
              className="settings-lang-select"
              items={[
                {
                  value: SYSTEM_LANG,
                  label: t('settings.general.language.system', {
                    lang: CATALOGS[systemLang].nativeName
                  })
                },
                // Each language is written in its own language, so it can be found without
                // knowing the current one. Not a translation target.
                ...LANGS.map((l) => ({ value: l, label: CATALOGS[l].nativeName }))
              ]}
              value={storedLang ?? SYSTEM_LANG}
              onChange={(v) => setLang(v === SYSTEM_LANG ? null : (v as Lang))}
              ariaLabel={t('settings.general.language')}
            />
          </div>
        </SettingRow>
        {/* Which kind the two session dialogs open on. A plain enum with nothing coupled
            to it, so — unlike the resume-strategy pair below, which earns its own
            component exactly because setting one can flip the other — a settings-row
            beside the language row is all this needs. It seeds each dialog's own
            selection and nothing else: picking the other kind inside the dialog belongs
            to that session and is not written back here. */}
        <SettingRow a="defaultKind" only={only}>
          <div className="settings-row">
            <span>{t('settings.defaultKind.title')}</span>
            <Select
              items={[
                { value: 'terminal', label: t('settings.defaultKind.terminal') },
                { value: 'chat', label: t('settings.defaultKind.chat') }
              ]}
              value={defaultSessionKind}
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
              ariaLabel={t('settings.defaultKind.title')}
            />
          </div>
          <p className="settings-hint">{t('settings.defaultKind.hint')}</p>
        </SettingRow>
        {/* W7-F (#84): an ended plan's tabs close on their own */}
        <SettingRow a="autoCloseTabs" only={only}>
          <AutoCloseTabsSetting on={autoCloseEndedPlanTabs} onChange={setAutoCloseEndedPlanTabs} />
        </SettingRow>
      </div>
      <SettingRow a="theme" only={only}>
        <ThemeSettings />
      </SettingRow>
      <SettingRow a="terminalFont" only={only}>
        <TerminalFontSettings />
      </SettingRow>
      <SettingRow a="shortcuts" only={only}>
        <ShortcutSettings overrides={keyOverrides} onChanged={setKeyOverrides} />
        {SHORTCUTS.map((g) => (
          <div className="shortcut-group" key={g.group}>
            <div className="shortcut-group-title">{t(g.group)}</div>
            {g.items.map((it) => (
              <div className="shortcut-row" key={it.desc}>
                <span className="shortcut-keys">
                  {it.gestureKey ? (
                    <kbd>{t(it.gestureKey)}</kbd>
                  ) : (
                    it.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="shortcut-or">{t('common.or')}</span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))
                  )}
                </span>
                <span className="shortcut-desc">{t(it.desc, { mod: MOD })}</span>
              </div>
            ))}
          </div>
        ))}
      </SettingRow>
    </>
  )
}
