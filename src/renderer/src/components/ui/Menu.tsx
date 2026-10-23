import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, type ButtonProps } from './UiButton'
import { contextMenuPoint, cx, isTypeaheadKey, menuKeyAction, moveIndex, typeaheadBuffer, typeaheadIndex } from './logic'
import { Kbd } from './Kbd'

export type MenuItem = {
  /** The row's React key; the index is used when it is missing (the old ContextMenu items have none). */
  id?: string
  label: React.ReactNode
  onSelect: () => void
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  /** A chord shown on the right as a Kbd ("Ctrl+Alt+N"). */
  shortcut?: string
  /** Given (true or false), the row is a checkable item with a check slot; true draws the check. */
  checked?: boolean
}

type Items = Array<MenuItem | 'separator'>

/** Where to open a context menu from an `onContextMenu` event: at the pointer, or under the focused element when the
 *  keyboard raised it (Shift+F10, the ContextMenu key). Call `preventDefault()` on the event yourself. */
export function menuPointOf(e: React.MouseEvent): { x: number; y: number } {
  const native = e.nativeEvent as MouseEvent & { pointerType?: string }
  return contextMenuPoint({ clientX: e.clientX, clientY: e.clientY, pointerType: native.pointerType }, (e.currentTarget as HTMLElement).getBoundingClientRect())
}

/** The open list, shared by both modes. Takes focus on its first enabled row; arrows, Home/End and typeahead move
 *  focus over the enabled rows; Enter/Space activate (the rows are native buttons); `onKey` gets Esc and Tab. */
function MenuList({
  items,
  label,
  id,
  className,
  style,
  listRef,
  onPick,
  onKey
}: {
  items: Items
  label?: string
  id?: string
  className: string
  style?: React.CSSProperties
  listRef: React.RefObject<HTMLDivElement | null>
  onPick: (it: MenuItem) => void
  onKey: (key: 'close' | 'tab') => void
}): React.JSX.Element {
  const typed = useRef({ text: '', at: 0 })

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-roving]:not([disabled])')?.focus()
  }, [listRef])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-roving]') ?? [])
    const off = rows.map((r) => r.disabled)
    const current = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (isTypeaheadKey(e)) {
      const now = Date.now()
      const text = typeaheadBuffer(typed.current.text, typed.current.at, e.key, now)
      typed.current = { text, at: now }
      const hit = typeaheadIndex(rows.map((r) => r.textContent ?? ''), off, text, current)
      if (hit >= 0) {
        e.preventDefault()
        rows[hit].focus()
      }
      return
    }
    const action = menuKeyAction(e.key)
    if (action === null || action === 'activate') return // the focused native button clicks itself
    if (action === 'close' || action === 'tab') {
      if (action === 'close') {
        e.preventDefault()
        e.stopPropagation()
      }
      onKey(action)
      return
    }
    e.preventDefault()
    const next = moveIndex(current, off, action.move)
    if (next >= 0) rows[next].focus()
  }

  return (
    <div ref={listRef} id={id} role="menu" aria-label={label} className={className} style={style} onKeyDown={onKeyDown}>
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={`sep-${i}`} role="separator" className="ui-menu__sep" />
        ) : (
          <button
            key={it.id ?? `item-${i}`}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            data-roving=""
            tabIndex={-1}
            disabled={it.disabled}
            className={cx('ui-menu__item', it.danger && 'ui-menu__item--danger')}
            onClick={() => onPick(it)}
          >
            {it.checked !== undefined && <span className="ui-menu__check">{it.checked && <Check size={14} aria-hidden="true" />}</span>}
            {it.icon}
            <span className="ui-menu__label">{it.label}</span>
            {it.shortcut && <Kbd className="ui-menu__kbd">{it.shortcut}</Kbd>}
          </button>
        )
      )}
    </div>
  )
}

type TriggerProps = {
  /** 'separator' draws a hairline between groups. */
  items: Items
  /** aria-label of the trigger (and the menu). */
  label: string
  /** Props of the trigger Button (icon, children, variant…). */
  trigger?: Omit<ButtonProps, 'onClick' | 'aria-haspopup' | 'aria-expanded'>
  align?: 'start' | 'end'
  at?: undefined
}

type ContextProps = {
  items: Items
  /** Context mode: the menu is open at this viewport point (from `menuPointOf`) until `onClose`. */
  at: { x: number; y: number }
  onClose: () => void
  label?: string
}

/** A list of actions. Two modes:
 *  - a trigger button that opens it ("⋯" row menus, the project switcher, "All tabs"): `label`, `trigger`, `align`;
 *  - a context menu (right-click, Shift+F10, the ContextMenu key): `at` and `onClose`, the caller owns the open state.
 *  Both: ArrowUp/Down/Home/End and typeahead move, Enter/Space pick, Esc closes and gives focus back, Tab closes,
 *  an outside click closes. */
export function Menu(props: TriggerProps | ContextProps): React.JSX.Element {
  return props.at ? <ContextMenuView {...props} /> : <TriggerMenu {...props} />
}

function TriggerMenu({ items, label, trigger, align = 'start' }: TriggerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const closeToTrigger = (): void => {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div ref={root} className="ui-menu">
      <Button
        aria-label={label}
        {...trigger}
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <MenuList
          items={items}
          label={label}
          id={menuId}
          className={cx('ui-menu__list', `ui-menu__list--${align}`)}
          listRef={list}
          onPick={(it) => {
            closeToTrigger()
            it.onSelect()
          }}
          onKey={(k) => (k === 'close' ? closeToTrigger() : setOpen(false))}
        />
      )}
    </div>
  )
}

function ContextMenuView({ items, at, onClose, label }: ContextProps): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: at.x, top: at.y })
  const close = useRef(onClose)
  close.current = onClose
  /** Whatever had focus when the menu opened (the tab, the row, the terminal): it gets focus back on Esc or a pick. */
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const closeToOpener = (): void => {
    close.current()
    opener?.focus()
  }

  // Flip against the window edges using the measured size, before the first paint
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const r = el.getBoundingClientRect()
    setPos({
      left: at.x + r.width > innerWidth ? Math.max(0, at.x - r.width) : at.x,
      top: at.y + r.height > innerHeight ? Math.max(0, at.y - r.height) : at.y
    })
  }, [at.x, at.y])

  useEffect(() => {
    const outside = (e: MouseEvent): void => {
      if (!list.current?.contains(e.target as Node)) close.current()
    }
    // Capture phase, as the old ContextMenu: Esc closes only the menu, before any handler in the tree (a Modal, the
    // app's global keys) sees it — also when focus never reached the menu (every row disabled).
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close.current()
      opener?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc, true)
    }
  }, [opener])

  return (
    <MenuList
      items={items}
      label={label}
      className="ui-menu__list ui-menu__list--context"
      style={{ left: pos.left, top: pos.top }}
      listRef={list}
      onPick={(it) => {
        closeToOpener()
        it.onSelect()
      }}
      onKey={(k) => (k === 'close' ? closeToOpener() : close.current())}
    />
  )
}
