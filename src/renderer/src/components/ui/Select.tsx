import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  groupRowsOf, menuAlignment, menuPlacement,
  type MenuAlignment, type MenuPlacement, type SelectItem
} from '../../../../core/ui/select'
import { useI18n } from '../../i18n/I18nProvider'
import { cx, isTypeaheadKey, listboxKeyAction, moveIndex, typeaheadBuffer, typeaheadIndex } from './logic'

/** An item plus the icon the component draws for it. The icon is a ReactNode, so it cannot live in
 *  core/ui/select.ts (that module is framework-free to stay testable). */
export interface SelectOption extends SelectItem {
  icon?: React.ReactNode
  /** Renders this row's label and meta in the given CSS font-family. The font picker uses it to draw
   *  each family in itself, which is what lets the user see at a glance whether a font has Hangul —
   *  a font without it shows the sample as tofu. */
  font?: string
  /** Shown but not pickable: the arrows, typeahead and the pointer pass over it. */
  disabled?: boolean
}

/** What a native-shape onChange gets: the one field every caller reads, `e.target.value`. */
export type SelectChange = { target: { value: string } }

type SelectCommon = {
  value: string
  /** Shown when nothing matches `value`. Defaults to the shared "not selected" string. */
  placeholder?: string
  className?: string
  /** Drops the trailing check mark. For a list whose icons already differ per row — accounts, where the
   *  Claude/Codex badge is the row's identity — a check would make two marks compete for the eye. Selection
   *  still shows in the label colour. */
  noCheck?: boolean
  ariaLabel?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  /** The trigger's id, so a <label htmlFor> names it. */
  id?: string
  /** Shown but not opened: a choice the form cannot use right now. */
  disabled?: boolean
}

/** The list form: items in, the picked value out. */
export type ListboxSelectProps = SelectCommon & { items: SelectOption[]; onChange: (value: string) => void; children?: undefined }
/** The native form the old `<select>` callers use: `<option>`/`<optgroup>` children and an event-shaped onChange.
 *  Kept so those call sites compile unchanged; new code passes `items`. */
export type NativeSelectProps = SelectCommon & { items?: undefined; onChange?: (e: SelectChange) => void; children: React.ReactNode }
export type SelectProps = ListboxSelectProps | NativeSelectProps

/** Distance between trigger and menu. Must stay equal to the 4px in .sel-menu's `top`/`bottom`. */
const MENU_GAP = 4
/** .sel-menu's own max-height. Needed here because the side decision depends on how tall the menu can
 *  get, and the CSS cap is the answer for any list longer than the cap. */
const MENU_MAX_H = 240
/** .sel-menu's own max-width, `min(420px, 70vw)`. Same reason as MENU_MAX_H, and it has to be read at
 *  measure time because the viewport half of it moves. */
const menuMaxW = (): number => Math.min(420, window.innerWidth * 0.7)

/** The box the menu has to stay inside: every scrolling or clipping ancestor intersected with the
 *  window. Both kinds have to count — the settings modal clips with `overflow: hidden` while the panel
 *  inside it scrolls with `overflow-y: auto`, and the tighter of the two is what the user sees. */
function clipBoxOf(el: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  let top = 0
  let bottom = window.innerHeight
  let left = 0
  let right = window.innerWidth
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p)
    // Either axis being non-visible clips both: a box with `overflow-y: auto` and no overflow-x of its
    // own still computes overflow-x to auto, so it cuts sideways as well.
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue
    const box = p.getBoundingClientRect()
    top = Math.max(top, box.top)
    bottom = Math.min(bottom, box.bottom)
    left = Math.max(left, box.left)
    right = Math.min(right, box.right)
  }
  return { top, bottom, left, right }
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** The items of native `<option>`/`<optgroup>` children, in order; an optgroup's label becomes its options' group. */
export function itemsOfOptions(children: React.ReactNode, group?: string): SelectOption[] {
  const out: SelectOption[] = []
  Children.forEach(children, (c) => {
    if (!isValidElement<{ children?: React.ReactNode; value?: unknown; label?: unknown; disabled?: boolean }>(c)) return
    if (c.type === Fragment) out.push(...itemsOfOptions(c.props.children, group))
    else if (c.type === 'optgroup') out.push(...itemsOfOptions(c.props.children, String(c.props.label ?? '')))
    else if (c.type === 'option') {
      const label = textOf(c.props.children)
      out.push({ value: c.props.value === undefined ? label : String(c.props.value), label, group, disabled: c.props.disabled || undefined })
    }
  })
  return out
}

/**
 * The app's one dropdown. Everything that picks from a list uses this, so there is a single look and a
 * single set of keyboard rules.
 *
 * Why not a native `<select>`: an `<option>` renders text only, so a per-row icon — the provider badge on
 * an account, the branch glyph on a branch — is impossible in one. That constraint is why AccountSelect was
 * already custom before this component existed; this generalises it rather than adding a second style.
 *
 * The cost of leaving native behind is that keyboard handling, outside-click dismissal and the ARIA roles
 * are ours to get right, which is what most of this file is. It is the WAI-ARIA select-only combobox: focus
 * stays on the trigger and `aria-activedescendant` names the row under the cursor; arrows, Home/End and
 * typeahead move over the enabled rows; Enter/Space pick; Esc closes only the list; Tab closes and moves on.
 */
// Two signatures so JSX picks the form by its props and types the onChange parameter. The list form is last:
// createElement(Select, …) types against the last one.
export function Select(props: NativeSelectProps): React.JSX.Element
export function Select(props: ListboxSelectProps): React.JSX.Element
export function Select(props: SelectProps): React.JSX.Element {
  const { value, placeholder, className, noCheck = false, disabled = false, id } = props
  const ariaLabel = props.ariaLabel ?? props['aria-label']
  const items: SelectOption[] = props.items ?? itemsOfOptions(props.children)
  const pick = (v: string): void => {
    if (props.items) props.onChange(v)
    else props.onChange?.({ target: { value: v } })
  }

  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (i: number): string => `${baseId}-opt-${i}`
  const [box, setBox] = useState<MenuPlacement & MenuAlignment>({
    side: 'below',
    maxHeight: null,
    align: 'left',
    maxWidth: null
  })

  const selected = items.find((it) => it.value === value) ?? null
  const rows = groupRowsOf(items)
  const off = items.map((it) => it.disabled === true)
  // Reserve the icon column for every row once any row has an icon, so labels line up in a mixed list
  // (the account filter's "All accounts" row has no badge). This is what provider-badge-spacer used to do.
  const anyIcon = items.some((it) => it.icon !== undefined)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  // Home/End and typeahead can jump past the visible rows: keep the cursor row in view.
  useEffect(() => {
    if (open) document.getElementById(optionId(cursor))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, cursor]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Which side and which edge to open from, measured after the menu is in the DOM but before the
   *  browser paints it —
   *  useLayoutEffect, not useEffect, or the first frame shows the menu below and it jumps.
   *
   *  Measured from scrollHeight rather than the rendered height: the rendered one is already capped
   *  (by the CSS, or by the max-height this very effect sets), so feeding it back in would let a menu
   *  that flipped once stay stuck at that height. The ResizeObserver is what catches the font pickers,
   *  whose lists arrive asynchronously — the menu opens one row tall ("checking installed fonts…") and
   *  grows to full height a second later, long after this effect first ran. */
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const rect = trigger.getBoundingClientRect()
      const clip = clipBoxOf(trigger)
      // offsetWidth - clientWidth is the gutter scrollWidth leaves out: the 1px border on each side
      // (box-sizing is border-box app-wide) plus the vertical scrollbar, which a list past the height
      // cap always has. Measured on the reported case: 297 + 12 = the 309 the menu actually renders at,
      // where scrollWidth alone would have understated it by the scrollbar and let a menu 10px too wide
      // pass as fitting.
      const gutter = menu.offsetWidth - menu.clientWidth
      const next = {
        ...menuPlacement(rect, clip, Math.min(menu.scrollHeight, MENU_MAX_H), MENU_GAP),
        ...menuAlignment(rect, clip, Math.min(menu.scrollWidth + gutter, menuMaxW()))
      }
      setBox((prev) =>
        prev.side === next.side && prev.maxHeight === next.maxHeight &&
        prev.align === next.align && prev.maxWidth === next.maxWidth
          ? prev
          : next
      )
    }
    measure()
    const menu = menuRef.current
    if (!menu) return
    const ro = new ResizeObserver(measure)
    ro.observe(menu)
    return () => ro.disconnect()
  }, [open, items.length])

  const openList = (at?: number): void => {
    const current = items.findIndex((it) => it.value === value)
    setCursor(at ?? (current >= 0 && !off[current] ? current : Math.max(0, moveIndex(-1, off, 'next'))))
    setOpen(true)
  }

  const commit = (i: number): void => {
    const item = items[i]
    if (!item || item.disabled) return
    pick(item.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (isTypeaheadKey(e)) {
      const now = Date.now()
      const text = typeaheadBuffer(typed.current.text, typed.current.at, e.key, now)
      typed.current = { text, at: now }
      const from = open ? cursor : items.findIndex((it) => it.value === value)
      const hit = typeaheadIndex(items.map((it) => it.label), off, text, from)
      if (hit < 0) return
      e.preventDefault()
      if (open) setCursor(hit)
      else openList(hit)
      return
    }
    const action = listboxKeyAction(e.key, open)
    if (action === null) return
    if (action === 'tab') {
      setOpen(false) // focus moves on by itself
      return
    }
    e.preventDefault()
    if (action === 'open') openList()
    else if (action === 'close') {
      e.stopPropagation() // closes only the list, not the Modal around it
      setOpen(false)
    } else if (action === 'commit') commit(cursor)
    else {
      const next = moveIndex(cursor, off, action.move)
      if (next >= 0) setCursor(next)
    }
  }

  const iconCell = (item: SelectOption): React.JSX.Element | null =>
    anyIcon ? <span className="sel-icon">{item.icon}</span> : null

  return (
    <div className={className ? `sel ${className}` : 'sel'} data-open={open} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className="sel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && items[cursor] ? optionId(cursor) : undefined}
        aria-label={ariaLabel}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <>
            {iconCell(selected)}
            <span className="sel-value" style={selected.font ? { fontFamily: selected.font } : undefined}>
              {selected.label}
            </span>
          </>
        ) : (
          <span className="sel-value empty">{placeholder ?? t('account.select.none')}</span>
        )}
        <span className="sel-caret" aria-hidden="true">
          <ChevronDown size={14} />
        </span>
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={listId}
          className={
            'sel-menu' + (box.side === 'above' ? ' above' : '') + (box.align === 'right' ? ' right' : '')
          }
          style={{
            ...(box.maxHeight === null ? null : { maxHeight: box.maxHeight }),
            ...(box.maxWidth === null ? null : { maxWidth: box.maxWidth })
          }}
          role="listbox"
          aria-label={ariaLabel}
          // keeps focus on the trigger, which owns the keyboard (aria-activedescendant)
          onMouseDown={(e) => e.preventDefault()}
        >
          {rows.map((row, r) =>
            row.kind === 'group' ? (
              // role=presentation: a heading is not selectable, and without this a screen reader would
              // count it as an option and misreport the list length
              <li key={`g-${r}-${row.label}`} className="sel-group" role="presentation">
                {row.label}
              </li>
            ) : (
              <li
                key={`o-${row.index}-${row.item.value}`}
                id={optionId(row.index)}
                role="option"
                aria-selected={row.item.value === value}
                aria-disabled={off[row.index] || undefined}
                className={cx('sel-option', row.index === cursor && 'cursor', off[row.index] && 'disabled')}
                onMouseEnter={() => !off[row.index] && setCursor(row.index)}
                onClick={() => commit(row.index)}
              >
                {iconCell(items[row.index])}
                <span className="sel-value" style={items[row.index].font ? { fontFamily: items[row.index].font } : undefined}>
                  {row.item.label}
                </span>
                {row.item.meta && (
                  <span className="sel-meta" style={items[row.index].font ? { fontFamily: items[row.index].font } : undefined}>
                    {row.item.meta}
                  </span>
                )}
                {!noCheck && (
                  <span className="sel-check" aria-hidden="true">
                    <Check size={14} />
                  </span>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}
