import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx, readSectionOpen, writeSectionOpen } from './logic'

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export type SectionProps = {
  /** Persists the open state under `cm.section.<id>`. */
  id: string
  label: React.ReactNode
  count?: number
  action?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}

export function Section({ id, label, count, action, defaultOpen = true, children }: SectionProps): React.JSX.Element {
  const [open, setOpen] = useState(() => readSectionOpen(storage(), id, defaultOpen))
  const bodyId = `ui-section-${id}`
  const toggle = (): void => {
    setOpen(!open)
    writeSectionOpen(storage(), id, !open)
  }
  return (
    <section className={cx('ui-section', open && 'ui-section--open')}>
      <div className="ui-section__head">
        <button type="button" className="ui-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <ChevronRight size={14} className="ui-section__chevron" aria-hidden="true" />
          <span className="ui-section__label">{label}</span>
          {count !== undefined && <span className="ui-section__count">{count}</span>}
        </button>
        {action && <div className="ui-section__action">{action}</div>}
      </div>
      {open && (
        <div id={bodyId} className="ui-section__body">
          {children}
        </div>
      )}
    </section>
  )
}
