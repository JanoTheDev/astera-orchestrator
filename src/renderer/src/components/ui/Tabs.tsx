import { useRef } from 'react'
import { cx } from './logic'
import { rovingKeyDown } from './Nav'

export type TabItem<K extends string> = { id: K; label: React.ReactNode; count?: number; disabled?: boolean }

/** A tab list: `underline` (a text strip with an accent underline; `strip` is its old name) or `segmented`
 *  (a scope choice in a PageHeader's filters row). Arrow keys move focus; Enter/Space select. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  variant = 'underline',
  label
}: {
  items: TabItem<K>[]
  value: K
  onChange: (id: K) => void
  variant?: 'underline' | 'strip' | 'segmented'
  label?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cx('ui-tabs', `ui-tabs--${variant === 'strip' ? 'underline' : variant}`)} onKeyDown={(e) => rovingKeyDown(ref.current, e)}>
      {items.map((it) => {
        const selected = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            data-roving=""
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={it.disabled}
            className={cx('ui-tabs__tab', selected && 'ui-tabs__tab--active')}
            onClick={() => onChange(it.id)}
          >
            {it.label}
            {it.count !== undefined && <span className="ui-tabs__count">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
