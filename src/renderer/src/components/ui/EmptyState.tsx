import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

/** The one empty state of a page: an icon in a soft circle, an optional headline, one sentence, the page's primary action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  detail,
  role
}: {
  icon?: LucideIcon
  /** One-line headline (--fs-15); the children are the sentence under it. */
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  /** Extra block under the sentence (a technical detail); a block element is fine here. */
  detail?: React.ReactNode
  /** `alert` for an error state, so a screen reader announces it. */
  role?: 'alert' | 'status'
}): React.JSX.Element {
  return (
    <div className="ui-empty" role={role}>
      {icon && (
        <span className="ui-empty__icon">
          <Icon icon={icon} size={20} />
        </span>
      )}
      {title != null && <p className="ui-empty__title">{title}</p>}
      {children != null && <p className="ui-empty__text">{children}</p>}
      {detail != null && <div className="ui-empty__detail">{detail}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  )
}
