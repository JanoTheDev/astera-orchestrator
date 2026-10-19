import { forwardRef } from 'react'
import { cx } from './logic'

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** The glyph: a lucide element at 16px (14px for size sm). */
  icon: React.ReactNode
  /** Required: it becomes aria-label and the hover title, so an icon-only button is never unnamed. */
  label: string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  /** A toggled-on state (an open menu's trigger, an active view option). */
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', variant = 'ghost', active = false, className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx('ui-btn', 'ui-btn--icon', `ui-btn--${variant}`, `ui-btn--${size}`, active && 'is-active', className)}
      {...rest}
    >
      {icon}
    </button>
  )
})
