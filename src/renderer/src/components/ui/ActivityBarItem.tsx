import { forwardRef } from 'react'
import { badgeText, cx } from './logic'

export type ActivityBarItemProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** A 24px lucide element. */
  icon: React.ReactNode
  /** aria-label and hover title; the count is added to the aria-label. */
  label: string
  active?: boolean
  /** A count bottom-right of the icon: hidden at 0, "9+" above 9. */
  badge?: number
}

/** A 48x48 activity-bar button (DESIGN-W13 §3): dim icon, full colour on hover and when active, plus a 2px accent bar
 *  on the left edge when active. `aria-pressed` carries the active state. */
export const ActivityBarItem = forwardRef<HTMLButtonElement, ActivityBarItemProps>(function ActivityBarItem(
  { icon, label, active = false, badge, className, type = 'button', ...rest },
  ref
) {
  const text = badgeText(badge)
  return (
    <button
      ref={ref}
      type={type}
      aria-label={text ? `${label} (${badge})` : label}
      aria-pressed={active}
      title={label}
      className={cx('ui-activity', active && 'is-active', className)}
      {...rest}
    >
      {icon}
      {text && (
        <span className="ui-activity__badge" aria-hidden="true">
          {text}
        </span>
      )}
    </button>
  )
})
