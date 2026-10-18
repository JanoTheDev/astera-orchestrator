import { useRef } from 'react'
import { cx, nextFocusIndex } from './logic'

export type NavItem<K extends string> = { id: K; label: React.ReactNode; count?: number }

/** Roving arrow-key focus over the buttons inside `container`. */
export function rovingKeyDown(container: HTMLElement | null, e: React.KeyboardEvent, orientation: 'horizontal' | 'vertical' = 'horizontal'): void {
  const items = Array.from(container?.querySelectorAll<HTMLElement>('[data-roving]:not([disabled])') ?? [])
  const next = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.key, orientation)
  if (next === null) return
  e.preventDefault()
  items[next]?.focus()
}

/** Top-bar page tabs: text with an accent underline on the current one. */
export function Nav<K extends string>({ items, current, onSelect, label }: { items: NavItem<K>[]; current: K; onSelect: (id: K) => void; label?: string }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  return (
    <nav ref={ref} className="ui-nav" aria-label={label} onKeyDown={(e) => rovingKeyDown(ref.current, e)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-roving=""
          className={cx('ui-nav__item', it.id === current && 'ui-nav__item--active')}
          aria-current={it.id === current ? 'page' : undefined}
          onClick={() => onSelect(it.id)}
        >
          {it.label}
          {it.count !== undefined && <span className="ui-nav__count">{it.count}</span>}
        </button>
      ))}
    </nav>
  )
}
