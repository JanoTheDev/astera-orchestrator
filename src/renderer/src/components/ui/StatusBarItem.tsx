import { cx } from './logic'

export type StatusBarItemProps = {
  /** A 14px lucide element. */
  icon?: React.ReactNode
  children?: React.ReactNode
  /** Given: a button; without it the item is plain text. */
  onClick?: () => void
  /** Hover title; also the aria-label of an icon-only item. */
  title?: string
  /** Status colour for the text and icon; pair it with a word. */
  tone?: 'warn' | 'danger'
  className?: string
}

/** A 22px status-bar entry (DESIGN-W13 §7): icon and text, a button with a --wash hover when it has `onClick`. */
export function StatusBarItem({ icon, children, onClick, title, tone, className }: StatusBarItemProps): React.JSX.Element {
  const cls = cx('ui-status', tone && `ui-status--${tone}`, onClick && 'is-action', className)
  const label = children == null ? title : undefined
  return onClick ? (
    <button type="button" className={cls} title={title} aria-label={label} onClick={onClick}>
      {icon}
      {children}
    </button>
  ) : (
    <span className={cls} title={title} aria-label={label} role={label ? 'img' : undefined}>
      {icon}
      {children}
    </span>
  )
}
