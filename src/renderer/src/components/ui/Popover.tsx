// A button that opens a panel under it (T9: the top bar's usage meter and the notification bell). What both need from
// it: an outside click or Esc closes, Esc gives focus back to the button, and the arrow keys move between the panel's
// `[data-roving]` rows. The panel's look is the caller's (`panelClassName`).
import { useEffect, useRef } from 'react'
import { cx, nextFocusIndex } from './logic'

type Focusable = { focus: () => void }

/** One key inside an open popover. Esc closes and focuses the trigger; ArrowUp/Down/Home/End move over `items` from
 *  `active` (-1: focus is not on a row). Returns whether the key was handled (the caller then prevents its default). */
export function popoverKeyDown(key: string, items: readonly Focusable[], active: number, close: () => void, trigger: Focusable | null): boolean {
  if (key === 'Escape') {
    close()
    trigger?.focus()
    return true
  }
  const next = nextFocusIndex(active, items.length, key, 'vertical')
  if (next === null) return false
  items[next]?.focus()
  return true
}

export function Popover({
  open,
  onOpenChange,
  label,
  trigger,
  children,
  className,
  panelClassName
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** aria-label of the panel. */
  label: string
  /** The button that toggles the panel; spread the given props on it (Enter/Space open it as a native button). */
  trigger: (p: { ref: React.RefObject<HTMLButtonElement | null>; 'aria-haspopup': 'dialog'; 'aria-expanded': boolean; onClick: () => void }) => React.ReactNode
  children: React.ReactNode
  className?: string
  panelClassName?: string
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const change = useRef(onOpenChange)
  change.current = onOpenChange

  useEffect(() => {
    if (!open) return
    // the first row takes focus, so the arrows work at once (also when the panel was opened from elsewhere)
    panel.current?.querySelector<HTMLElement>('[data-roving]:not([disabled])')?.focus()
    const outside = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) change.current(false)
    }
    // on the document, so Esc also closes while focus is still on the trigger
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      change.current(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') return // the document listener has it
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-roving]:not([disabled])') ?? [])
    if (popoverKeyDown(e.key, items, items.indexOf(document.activeElement as HTMLElement), () => change.current(false), button.current)) e.preventDefault()
  }

  return (
    <div ref={root} className={cx('ui-popover', className)}>
      {trigger({ ref: button, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => onOpenChange(!open) })}
      {open && (
        <div ref={panel} role="dialog" aria-label={label} className={panelClassName} onKeyDown={onKeyDown}>
          {children}
        </div>
      )}
    </div>
  )
}
