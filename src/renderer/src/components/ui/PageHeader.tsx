import { cx } from './logic'

export type PageHeaderProps = {
  title: React.ReactNode
  /** A count or one line under/after the title ("12 open"). */
  subtitle?: React.ReactNode
  /** Right side: at most one primary Button, the rest ghost. */
  actions?: React.ReactNode
  /** The row under the title: Tabs variant="segmented", Chips, search, view options. */
  filters?: React.ReactNode
  /** Before the title: a Back ghost button, a page icon. */
  leading?: React.ReactNode
  className?: string
}

/** Every page's header (DESIGN-W11 §7): title and actions on one line, the filters row under them. */
export function PageHeader({ title, subtitle, actions, filters, leading, className }: PageHeaderProps): React.JSX.Element {
  return (
    <header className={cx('ui-page-header', className)}>
      <div className="ui-page-header__row">
        {leading && <div className="ui-page-header__leading">{leading}</div>}
        <div className="ui-page-header__titles">
          <h1 className="ui-page-header__title">{title}</h1>
          {subtitle != null && <span className="ui-page-header__subtitle">{subtitle}</span>}
        </div>
        {actions && <div className="ui-page-header__actions">{actions}</div>}
      </div>
      {filters && <div className="ui-page-header__filters">{filters}</div>}
    </header>
  )
}
