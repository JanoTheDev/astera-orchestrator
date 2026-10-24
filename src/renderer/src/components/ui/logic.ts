// Pure logic behind the ui primitives, kept DOM-free so node tests cover it.

export type MeterTone = 'accent' | 'warn' | 'danger'

/** Clamp a meter value to 0..100; NaN and non-finite non-numbers read as 0. */
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** The usage-guard thresholds (DESIGN §10): under 75 accent, 75–89 warn, 90+ danger. */
export function meterTone(value: number): MeterTone {
  const v = clampPercent(value)
  return v >= 90 ? 'danger' : v >= 75 ? 'warn' : 'accent'
}

/** Roving focus for Tabs, Toolbar and Menu. `orientation` picks which arrows move; they wrap, Home/End jump. Null: not ours. */
export function nextFocusIndex(current: number, count: number, key: string, orientation: 'horizontal' | 'vertical' = 'horizontal'): number | null {
  if (count <= 0) return null
  const [prev, next] = orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  const from = current < 0 || current >= count ? -1 : current
  if (key === next) return (from + 1) % count
  if (key === prev) return from < 0 ? count - 1 : (from - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Roving arrow-key focus over the buttons inside `container`. */
export function rovingKeyDown(container: HTMLElement | null, e: React.KeyboardEvent, orientation: 'horizontal' | 'vertical' = 'horizontal'): void {
  const items = Array.from(container?.querySelectorAll<HTMLElement>('[data-roving]:not([disabled])') ?? [])
  const next = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.key, orientation)
  if (next === null) return
  e.preventDefault()
  items[next]?.focus()
}

export type ModalKeyAction = 'close' | { focus: number } | null

/** A modal's keys: Esc closes; Tab/Shift+Tab wrap focus at the ends (the trap); everything else is left alone.
 *  `activeIndex` is the focused element's index among the modal's focusables, -1 when focus is outside them. */
export function modalKeyAction(key: string, shiftKey: boolean, activeIndex: number, count: number): ModalKeyAction {
  if (key === 'Escape') return 'close'
  if (key !== 'Tab') return null
  if (count <= 0) return { focus: -1 } // nothing focusable: keep focus on the dialog itself
  if (shiftKey) return activeIndex <= 0 ? { focus: count - 1 } : null
  return activeIndex < 0 || activeIndex >= count - 1 ? { focus: 0 } : null
}

export function sectionStorageKey(id: string): string {
  return `cm.section.${id}`
}

/** A Section's saved open state; storage may be missing or throw (private window, blocked site data). */
export function readSectionOpen(storage: Pick<Storage, 'getItem'> | undefined, id: string, fallback: boolean): boolean {
  try {
    const v = storage?.getItem(sectionStorageKey(id))
    return v === '1' ? true : v === '0' ? false : fallback
  } catch {
    return fallback
  }
}

export function writeSectionOpen(storage: Pick<Storage, 'setItem'> | undefined, id: string, open: boolean): void {
  try {
    storage?.setItem(sectionStorageKey(id), open ? '1' : '0')
  } catch {
    /* storage unavailable: the state just isn't remembered */
  }
}

/** A ViewPane's saved flex-grow weight (about 1 = an equal share of the column; a pane's height is weight / sum of weights).
 *  Stored under `.weight`: the old px-scale `.size` values are never read, so those panes fall back to their default split. */
export function readPaneSize(storage: Pick<Storage, 'getItem'> | undefined, id: string): number | undefined {
  try {
    const n = Number(storage?.getItem(`${sectionStorageKey(id)}.weight`))
    return n > 0 && Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

export function writePaneSize(storage: Pick<Storage, 'setItem'> | undefined, id: string, size: number): void {
  try {
    storage?.setItem(`${sectionStorageKey(id)}.weight`, String(Math.round(size * 1000) / 1000))
  } catch {
    /* storage unavailable: the size just isn't remembered */
  }
}

/** The heights of a column of panes after the sash above pane `i` moves pane `i` to `px`. The sash trades height with
 *  the nearest open pane above it (collapsed panes between keep their header and are skipped, never resized): the pair's
 *  sum is kept, each stays at least `min`, every other height is untouched. A collapsed `i`, or no open pane above, is a no-op. */
export function resizePair(heights: number[], open: boolean[], i: number, px: number, min: number): number[] {
  let j = i - 1
  while (j >= 0 && !open[j]) j--
  if (j < 0 || !open[i]) return heights
  const pair = heights[j] + heights[i]
  const next = Math.min(Math.max(min, pair - min), Math.max(min, Math.round(px)))
  const out = heights.slice()
  out[i] = next
  out[j] = pair - next
  return out
}

/** The flex-grow weights for the two panes of a resized pair, given the weights they actually render with (`grows`: the
 *  saved weight, else the CSS flex-grow) and their new heights. `px` is the height one unit of weight takes among the
 *  flex-basis-0 panes of the column (height / weight of any of them), when there is one: weights are then `height / px`,
 *  which holds every other pane at its height even when a pair member was content-sized (`flex: none`) until now.
 *  Without such a reference the pair splits its combined weight. */
export function pairWeights(grows: [number, number], heights: [number, number], px?: number): [number, number] {
  if (px && px > 0) return [heights[0] / px, heights[1] / px]
  const total = grows[0] + grows[1] || 1
  const sum = heights[0] + heights[1] || 1
  return [(total * heights[0]) / sum, (total * heights[1]) / sum]
}

/** Join class names, skipping falsy ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/** What Tab can reach: a roving row (tabindex -1) is not in it, or the trap's last stop is a row Tab skips and focus leaves. */
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]'
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(',')

// ---- Keyboard for the list primitives (Select, Menu): moves skip disabled rows, typeahead finds rows by their label ----

export type ListMove = 'next' | 'prev' | 'first' | 'last'

/** The row a move lands on, skipping `disabled` ones; next/prev wrap. -1 when no row is enabled. */
export function moveIndex(current: number, disabled: readonly boolean[], move: ListMove): number {
  const n = disabled.length
  const enabled = (i: number): boolean => !disabled[i]
  if (move === 'first' || move === 'last') {
    const step = move === 'first' ? 1 : -1
    for (let k = 0, i = move === 'first' ? 0 : n - 1; k < n; k++, i += step) if (enabled(i)) return i
    return -1
  }
  const step = move === 'next' ? 1 : -1
  // from nowhere, next starts before the first row and prev after the last
  const from = current < 0 || current >= n ? (step === 1 ? -1 : n) : current
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n
    if (enabled(i)) return i
  }
  return -1
}

/** How long a pause ends a typeahead word (the WAI-ARIA practice uses about half a second). */
export const TYPEAHEAD_PAUSE_MS = 500

/** The typed word after `key`: it grows while keys come within the pause, and restarts after it. */
export function typeaheadBuffer(prev: string, prevAt: number, key: string, now: number): string {
  return now - prevAt > TYPEAHEAD_PAUSE_MS ? key : prev + key
}

/** A key that types ahead: one printable character, no Ctrl/Alt/Meta. Space is not one — it picks. */
export function isTypeaheadKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey
}

/** The row whose label starts with `query` (case-insensitive), skipping disabled ones; -1 when none.
 *  One letter (or one letter repeated) cycles: the search starts after `current`. A longer word starts at `current`,
 *  so the row stays put while the word still matches it. */
export function typeaheadIndex(labels: readonly string[], disabled: readonly boolean[], query: string, current: number): number {
  if (query === '' || labels.length === 0) return -1
  const q = query.toLowerCase()
  const cycling = [...q].every((c) => c === q[0])
  const needle = cycling ? q[0] : q
  const n = labels.length
  const start = Math.max(0, current) + (cycling ? 1 : 0)
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (!disabled[i] && labels[i].toLowerCase().startsWith(needle)) return i
  }
  return -1
}

export type ListKeyAction = 'open' | 'close' | 'commit' | 'tab' | { move: ListMove } | null

const MOVE_KEYS: Record<string, ListMove> = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' }

/** A Select trigger's key. Closed: Enter, Space and the arrows open. Open: arrows and Home/End move, Enter/Space pick,
 *  Esc closes, Tab leaves (closing without picking). Typeahead is separate (isTypeaheadKey). Null: not ours. */
export function listboxKeyAction(key: string, open: boolean): ListKeyAction {
  if (!open) return key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp' ? 'open' : null
  if (key in MOVE_KEYS) return { move: MOVE_KEYS[key] }
  if (key === 'Enter' || key === ' ') return 'commit'
  if (key === 'Escape') return 'close'
  if (key === 'Tab') return 'tab'
  return null
}

export type MenuKeyAction = 'close' | 'activate' | 'tab' | { move: ListMove } | null

/** An open Menu's key: arrows and Home/End move focus, Enter/Space activate, Esc closes (focus back to the opener),
 *  Tab closes and lets focus go on. Null: not ours. */
export function menuKeyAction(key: string): MenuKeyAction {
  if (key in MOVE_KEYS) return { move: MOVE_KEYS[key] }
  if (key === 'Enter' || key === ' ') return 'activate'
  if (key === 'Escape') return 'close'
  if (key === 'Tab') return 'tab'
  return null
}

/** Where a context menu opens: at the pointer, or under the target when the keyboard (Shift+F10, the ContextMenu key)
 *  raised the event — that one has no pointer type, and some engines report it at 0,0. */
export function contextMenuPoint(
  e: { clientX: number; clientY: number; pointerType?: string },
  target: { left: number; bottom: number }
): { x: number; y: number } {
  const keyboard = e.pointerType === '' || (e.clientX === 0 && e.clientY === 0)
  return keyboard ? { x: target.left, y: target.bottom } : { x: e.clientX, y: e.clientY }
}

// ---- Workbench primitives (DESIGN-W13 §3, §12) ----

/** A Sash's new size: `start` moved by the pointer's `delta`, clamped to [min, max]. `reverse` for a handle on the
 *  pane's leading edge (a bottom panel grows when dragged up, a right side bar when dragged left). */
export function sashSize(start: number, delta: number, min: number, max: number, reverse = false): number {
  return Math.min(max, Math.max(min, Math.round(start + (reverse ? -delta : delta))))
}

/** The arrow-key step of a Sash (8px), signed like a pointer delta; 0 for other keys and the cross axis.
 *  A vertical sash (between left and right) moves with Left/Right, a horizontal one with Up/Down. */
export function sashKeyDelta(key: string, orientation: 'vertical' | 'horizontal'): number {
  const [less, more] = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  return key === more ? 8 : key === less ? -8 : 0
}

/** An activity-bar badge: hidden at 0 (empty string), the count up to 9, "9+" above. */
export function badgeText(count: number | undefined): string {
  if (!count || count <= 0 || !Number.isFinite(count)) return ''
  return count > 9 ? '9+' : String(Math.floor(count))
}
