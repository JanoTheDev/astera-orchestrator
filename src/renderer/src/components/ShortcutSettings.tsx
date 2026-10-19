import { useEffect, useState } from 'react'
import {
  chordFromEvent,
  findConflicts,
  formatChord,
  resolveBindings,
  riskyReasonKey,
  type ActionId
} from '../../../core/keys/binding'
import { ACTIONS } from '../lib/actions'
import { useI18n } from '../i18n/I18nProvider'
import { confirmModal } from '../lib/confirm'
import { toast } from '../lib/toast'
import type { MessageKey } from '../../../core/i18n'
import { Pencil, RotateCcw } from 'lucide-react'
import { IconButton, Kbd } from './ui'

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
  matches
}: {
  overrides: Record<string, string[]>
  onChanged: (next: Record<string, string[]>) => void
  /** The table's search (W11): whether a row with this name and these chords stays. */
  matches: (name: string, keys: string[]) => boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [capturing, setCapturing] = useState<ActionId | null>(null)
  const bindings = resolveBindings(overrides, ACTIONS)
  const conflicts = findConflicts(bindings, ACTIONS)

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
      const taken = ACTIONS.find((a) => a.id !== capturing && bindings[a.id].some((c) => formatChord(c) === key))
      setCapturing(null)
      if (taken) {
        toast.error(
          t('shortcut.conflictWith', {
            key,
            action: t(taken.descKey as MessageKey, taken.descParams)
          })
        )
        return
      }
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
        <th colSpan={3} scope="colgroup">
          {t('shortcut.group.editable')}
        </th>
      </tr>
      {rows.map(({ action, name, keys }) => {
        const conflicted = conflicts.some((c) => c.actions.includes(action.id))
        return (
          <tr key={action.id}>
            <td>{name}</td>
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
            <td>
              <span className="shortcut-table__actions">
                <IconButton
                  size="sm"
                  icon={<Pencil size={14} />}
                  label={t('shortcut.edit')}
                  disabled={capturing !== null}
                  onClick={() => setCapturing(action.id)}
                />
                <IconButton
                  size="sm"
                  icon={<RotateCcw size={14} />}
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
