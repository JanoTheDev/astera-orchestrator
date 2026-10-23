import { useEffect, useState } from 'react'
import {
  chordFromEvent,
  formatChord,
  resolveBindings,
  riskyReasonKey,
  type ActionId
} from '../../../core/keys/binding'
import { ACTIONS } from '../lib/actions'
import { useI18n } from '../i18n/I18nProvider'
import { confirmModal } from '../lib/confirm'
import type { MessageKey } from '../../../core/i18n'
import { conflictsOf, shortcutMatches, sourceOf, takenBy } from './command/shortcutModel'
import { Icon, IconButton, Input, Kbd } from './ui'
import './command/keys.css'

/** The editable shortcuts as the table shows them: the action, its name and its chords. */
export function shortcutRows(
  bindings: ReturnType<typeof resolveBindings>,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): Array<{ action: (typeof ACTIONS)[number]; name: string; keys: string[] }> {
  return ACTIONS.map((action) => ({
    action,
    name: t(action.descKey as MessageKey, action.descParams),
    keys: bindings[action.id].map(formatChord)
  }))
}

/**
 * Shortcut settings. Only the actions handled by the global capture handler can be edited —
 * FileExplorer's DOM onKeyDown (F2, Delete, Ctrl+A/X/C/V) and the CodeMirror keymap (Ctrl+S) go through a
 * different handling mechanism, so they are outside this list and the caller shows them separately as a
 * 'fixed' list.
 *
 * Two things are checked before saving: a clash with another action is rejected, and for a key the
 * terminal CLI uses, the user is told what it would block and it is saved anyway if they still want it
 * (not blocking it was a deliberate decision).
 */
export function ShortcutSettings({
  overrides,
  onChanged,
  matches,
  showSource = false
}: {
  overrides: Record<string, string[]>
  onChanged: (next: Record<string, string[]>) => void
  /** The table's search (W11): whether a row with this name and these chords stays. */
  matches: (name: string, keys: string[]) => boolean
  /** The Keyboard Shortcuts tab adds a Source column (Default or User). */
  showSource?: boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [capturing, setCapturing] = useState<ActionId | null>(null)
  // A pressed chord another command holds is not taken; the row says so until the next try
  const [blocked, setBlocked] = useState<{ id: ActionId; key: string; action: string } | null>(null)
  const bindings = resolveBindings(overrides, ACTIONS)
  const conflicts = conflictsOf(bindings, ACTIONS)
  const nameOf = (a: (typeof ACTIONS)[number]): string => t(a.descKey as MessageKey, a.descParams)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const chord = chordFromEvent(e)
      if (!chord) return // only modifiers are down — wait for an actual key
      const key = formatChord(chord)
      const taken = takenBy(bindings, ACTIONS, capturing, key)
      setCapturing(null)
      if (taken) {
        setBlocked({ id: capturing, key, action: nameOf(taken) })
        return
      }
      setBlocked(null)
      const riskKey = riskyReasonKey(chord)
      void (async () => {
        if (riskKey) {
          const ok = await confirmModal({
            title: t('shortcut.riskTitle', { key }),
            body: t(riskKey as MessageKey),
            confirmLabel: t('shortcut.riskConfirm')
          })
          if (!ok) return
        }
        await window.api.keys.set(capturing, [key])
        onChanged(await window.api.keys.get())
      })()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, bindings, t, onChanged])

  const reset = async (id: ActionId): Promise<void> => {
    setBlocked(null)
    await window.api.keys.reset(id)
    onChanged(await window.api.keys.get())
  }

  // W11: rows of the Settings shortcut table (GeneralSettings draws the table): the name, its chord right beside it,
  // and change/reset that show on the hovered or focused row only.
  const rows = shortcutRows(bindings, t).filter((r) => matches(r.name, r.keys))
  if (rows.length === 0) return null
  return (
    <tbody>
      <tr className="shortcut-table__group">
        <th colSpan={showSource ? 4 : 3} scope="colgroup">
          {t('shortcut.group.editable')}
        </th>
      </tr>
      {rows.map(({ action, name, keys }) => {
        const clash = conflicts.get(action.id)?.[0]
        const clashWith = clash ? ACTIONS.find((a) => a.id === clash.others[0]) : undefined
        const conflicted = clash !== undefined
        const warn = blocked?.id === action.id ? t('shortcut.conflictWith', { key: blocked.key, action: blocked.action }) : clash && clashWith ? t('shortcut.conflictWith', { key: clash.key, action: nameOf(clashWith) }) : null
        return (
          <tr key={action.id}>
            <td>
              {name}
              {warn && (
                <span className="shortcut-table__warn" role="alert">
                  <Icon name="warning" size={14} /> {warn}
                </span>
              )}
            </td>
            <td>
              <span className="shortcut-table__keys">
                {capturing === action.id ? (
                  <span className="shortcut-table__state">{t('shortcut.capturing')}</span>
                ) : keys.length === 0 ? (
                  <span className="shortcut-table__state">{t('shortcut.unbound')}</span>
                ) : (
                  keys.map((k, i) => (
                    <span key={k} className="shortcut-table__keys">
                      {i > 0 && <span className="shortcut-table__state">{t('common.or')}</span>}
                      <Kbd className={conflicted ? 'shortcut-table__conflict' : undefined}>{k}</Kbd>
                    </span>
                  ))
                )}
              </span>
            </td>
            {showSource && <td className="shortcut-table__source">{t(sourceOf(overrides, action.id) === 'user' ? 'keys.source.user' : 'keys.source.default')}</td>}
            <td>
              <span className="shortcut-table__actions">
                <IconButton
                  size="sm"
                  icon={<Icon name="edit" size={14} />}
                  label={t('shortcut.edit')}
                  disabled={capturing !== null}
                  onClick={() => setCapturing(action.id)}
                />
                <IconButton
                  size="sm"
                  icon={<Icon name="reset" size={14} />}
                  label={t('shortcut.resetOne')}
                  disabled={capturing !== null || overrides[action.id] === undefined}
                  onClick={() => void reset(action.id)}
                />
              </span>
            </td>
          </tr>
        )
      })}
    </tbody>
  )
}

/** DESIGN-W13 §5: the Keyboard Shortcuts editor tab (`view:settings:keys`): a search over command names and chords, then
 *  Command | Keybinding | Source. Pressing Change and then a chord records it; Default puts the app's own back. */
export function KeyboardShortcuts({
  keyOverrides,
  setKeyOverrides
}: {
  keyOverrides: Record<string, string[]>
  setKeyOverrides: (next: Record<string, string[]>) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const matches = (name: string, keys: string[]): boolean => shortcutMatches(query, name, keys)
  const any = shortcutRows(resolveBindings(keyOverrides, ACTIONS), t).some((r) => matches(r.name, r.keys))
  return (
    <div className="keys-view" role="region" aria-label={t('keys.title')}>
      <div className="keys-view__head">
        <h2 className="keys-view__title">{t('keys.title')}</h2>
        <label className="settings-page__search keys-view__search">
          <Icon name="search" size={14} />
          <Input
            type="search"
            autoFocus
            value={query}
            placeholder={t('keys.search')}
            aria-label={t('keys.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <table className="shortcut-table keys-view__table">
        <thead>
          <tr>
            <th scope="col">{t('keys.command')}</th>
            <th scope="col">{t('keys.keybinding')}</th>
            <th scope="col">{t('keys.source')}</th>
            <th scope="col" aria-hidden="true" />
          </tr>
        </thead>
        <ShortcutSettings overrides={keyOverrides} onChanged={setKeyOverrides} matches={matches} showSource />
      </table>
      {!any && <p className="settings-hint">{t('settings.shortcuts.empty', { query: query.trim() })}</p>}
    </div>
  )
}
