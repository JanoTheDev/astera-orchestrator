import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx, readSectionOpen, writeSectionOpen } from './logic'
import { Badge } from './Badge'

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export type ViewPaneProps = {
  title: React.ReactNode
  /** A count badge after the title; hidden when undefined. */
  count?: number
  /** Header actions (sm `IconButton`s or a `Toolbar`), shown on hover or focus-within. */
  actions?: React.ReactNode
  /** Persists the expanded state under `cm.section.<storageKey>`; without it the state lives in memory. */
  storageKey?: string
  defaultExpanded?: boolean
  children: React.ReactNode
  className?: string
}

/** A collapsible side-bar section (DESIGN-W13 §12): a 22px header with twistie, uppercase title, count and hover
 *  actions, then a body that scrolls. Stack them in a `ViewContainer`, which shares the height among the open ones. */
export function ViewPane({ title, count, actions, storageKey, defaultExpanded = true, children, className }: ViewPaneProps): React.JSX.Element {
  const [open, setOpen] = useState(() => (storageKey ? readSectionOpen(storage(), storageKey, defaultExpanded) : defaultExpanded))
  const bodyId = useId()
  const toggle = (): void => {
    setOpen(!open)
    if (storageKey) writeSectionOpen(storage(), storageKey, !open)
  }
  return (
    <section className={cx('ui-viewpane', open && 'is-open', className)}>
      <div className="ui-viewpane__head">
        <button type="button" className="ui-viewpane__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <ChevronRight size={16} className="ui-viewpane__twistie" aria-hidden="true" />
          <span className="ui-viewpane__title">{title}</span>
          {count !== undefined && <Badge className="ui-viewpane__count">{count}</Badge>}
        </button>
        {actions && <div className="ui-viewpane__actions">{actions}</div>}
      </div>
      {open && (
        <div id={bodyId} className="ui-viewpane__body">
          {children}
        </div>
      )}
    </section>
  )
}

/** The column of `ViewPane`s in a side-bar view: open panes split the height, closed ones keep only their header. */
export function ViewContainer({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }): React.JSX.Element {
  return (
    <div className={cx('ui-viewcontainer', className)} aria-label={label}>
      {children}
    </div>
  )
}
