import { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx } from './logic'
import { rovingKeyDown } from './Nav'
import { IconButton } from './IconButton'
import { Menu, type MenuItem } from './Menu'
import type { ButtonProps } from './UiButton'

export type ToolbarItem = {
  id: string
  /** A 16px lucide element. */
  icon: React.ReactNode
  /** aria-label and hover title. */
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

export type ToolbarProps = {
  items: ToolbarItem[]
  /** Rows of a trailing "⋯" Menu; none: no overflow button. */
  overflow?: Array<MenuItem | 'separator'>
  /** aria-label of the overflow button (the caller's i18n); required with `overflow`. */
  overflowLabel?: string
  /** aria-label of the toolbar. */
  label: string
  className?: string
}

/** A row of 22px icon buttons (a view title's or a pane header's actions), with an optional overflow Menu.
 *  `role="toolbar"`: one Tab stop, Left/Right/Home/End move between the buttons (roving tabindex). */
export function Toolbar({ items, overflow, overflowLabel, label, className }: ToolbarProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [stop, setStop] = useState(0)
  // the one Tab stop: the last focused button, or the first enabled one when that is gone or disabled
  const enabled = [...items.map((it) => !it.disabled), ...(overflow ? [true] : [])]
  const at = enabled[stop] ? stop : enabled.indexOf(true)
  const tab = (i: number): number => (i === at ? 0 : -1)
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className={cx('ui-toolbar', className)}
      onKeyDown={(e) => rovingKeyDown(ref.current, e)}
      onFocus={(e) => {
        const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])
        const i = all.indexOf(e.target as HTMLElement)
        if (i >= 0) setStop(i)
      }}
    >
      {items.map((it, i) => (
        <IconButton
          key={it.id}
          data-roving=""
          tabIndex={tab(i)}
          size="sm"
          icon={it.icon}
          label={it.label}
          active={it.active}
          aria-pressed={it.active}
          disabled={it.disabled}
          onClick={it.onClick}
        />
      ))}
      {overflow && (
        <Menu
          items={overflow}
          label={overflowLabel ?? label}
          align="end"
          trigger={{ icon: <MoreHorizontal size={16} />, size: 'sm', 'data-roving': '', tabIndex: tab(items.length) } as ButtonProps}
        />
      )}
    </div>
  )
}
