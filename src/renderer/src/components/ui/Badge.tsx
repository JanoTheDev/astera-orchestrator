import { cx } from './logic'
import type { ChipTone } from './Chip'

/** A small count or status pill (an unread count, "3 new"). It renders whatever it is given: the caller hides a zero. */
export function Badge({ tone = 'neutral', className, children }: { tone?: ChipTone; className?: string; children: React.ReactNode }): React.JSX.Element {
  return <span className={cx('ui-badge', `ui-badge--${tone}`, className)}>{children}</span>
}
