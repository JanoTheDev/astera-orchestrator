import { useEffect, useId, useRef, useState } from 'react'
import { Button, type ButtonProps } from './UiButton'
import { cx } from './logic'
import { rovingKeyDown } from './Nav'

export type MenuItem = { id: string; label: React.ReactNode; onSelect: () => void; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }

/** A button that opens a list of actions ("⋯" row menus, the project switcher, "All tabs").
 *  ArrowUp/Down/Home/End move, Enter picks (native button), Esc or an outside click closes. */
export function Menu({
  items,
  label,
  trigger,
  align = 'start'
}: {
  items: MenuItem[]
  /** aria-label of the trigger (and the menu). */
  label: string
  /** Props of the trigger Button (icon, children, variant…). */
  trigger?: Omit<ButtonProps, 'onClick' | 'aria-haspopup' | 'aria-expanded'>
  align?: 'start' | 'end'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[data-roving]:not([disabled])')?.focus()
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

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeToTrigger()
    } else if (e.key === 'Tab') setOpen(false)
    else rovingKeyDown(list.current, e, 'vertical')
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
        <div ref={list} id={menuId} role="menu" aria-label={label} className={cx('ui-menu__list', `ui-menu__list--${align}`)} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              data-roving=""
              tabIndex={-1}
              disabled={it.disabled}
              className={cx('ui-menu__item', it.danger && 'ui-menu__item--danger')}
              onClick={() => {
                closeToTrigger()
                it.onSelect()
              }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
