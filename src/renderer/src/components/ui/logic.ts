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

/** Roving focus for Nav, Tabs and Menu. `orientation` picks which arrows move; they wrap, Home/End jump. Null: not ours. */
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

/** Join class names, skipping falsy ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
