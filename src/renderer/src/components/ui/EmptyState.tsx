import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

export function EmptyState({ icon, children, action }: { icon?: LucideIcon; children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ui-empty">
      {icon && <Icon icon={icon} size={20} className="ui-empty__icon" />}
      <p className="ui-empty__text">{children}</p>
      {action}
    </div>
  )
}
