// The Keyboard Shortcuts editor's rules (ShortcutSettings.tsx draws them): where a binding comes from, who else holds a
// chord, and what the search keeps. Pure, over binding.ts's own types.
import { findConflicts, formatChord, migrateOverrides, type ActionId, type ActionSpec, type Bindings } from '../../../../core/keys/binding'

export type KeySource = 'default' | 'user'

/** `user` once the person has set (or cleared) the action's keys, else the app's `default`. */
export const sourceOf = (overrides: Partial<Record<string, string[]>>, id: ActionId): KeySource =>
  migrateOverrides(overrides)[id] !== undefined ? 'user' : 'default'

/** The other action that already holds `chord` (as `Ctrl+K` text), if any. */
export function takenBy(bindings: Bindings, actions: readonly ActionSpec[], id: ActionId, chord: string): ActionSpec | undefined {
  return actions.find((a) => a.id !== id && (bindings[a.id] ?? []).some((c) => formatChord(c) === chord))
}

/** For each action that shares a chord with another one, those others and the chord: the warning under its row. */
export function conflictsOf(bindings: Bindings, actions: readonly ActionSpec[]): Map<ActionId, Array<{ key: string; others: ActionId[] }>> {
  const out = new Map<ActionId, Array<{ key: string; others: ActionId[] }>>()
  for (const { key, actions: ids } of findConflicts(bindings, actions))
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), { key, others: ids.filter((o) => o !== id) }])
  return out
}

/** Whether a row stays for `query`: every word is in the command's name or in one of its chords. */
export function shortcutMatches(query: string, name: string, keys: readonly string[]): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const hay = [name, ...keys].join('\n').toLocaleLowerCase()
  return words.every((w) => hay.includes(w))
}
