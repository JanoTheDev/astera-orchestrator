import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx, isTypeaheadKey, typeaheadBuffer } from './logic'
import type { ChipTone } from './Chip'
import { TREE_DEFAULT_VIEWPORT_H, TREE_ROW_H, TREE_VIRTUAL_AFTER, treeKeyAction, treeRevealTop, treeTypeahead, treeWindow } from './treeNav'

export type TreeItem = {
  id: string
  /** 0 for a top-level row; each level indents 8px and draws an indent guide. */
  depth: number
  /** Plain text: type-ahead matches it. */
  label: string
  /** The row's tooltip (a full path, the word behind a status letter). */
  title?: string
  /** A 16px lucide element. */
  icon?: React.ReactNode
  /** Dim text after the label (a path, a branch). */
  description?: string
  /** A count or chip on the right (a `Badge`). */
  badge?: React.ReactNode
  /** A parent's open state; only read when `hasChildren`. */
  expanded?: boolean
  hasChildren?: boolean
  /** Hover actions (sm `IconButton`s); they replace the badge and decoration while the row is hovered or focused. */
  actions?: React.ReactNode
  /** A status mark on the right: icon plus a word, so colour is never the only cue. */
  decoration?: { icon?: React.ReactNode; text: string; tone?: ChipTone }
}

export type TreeRowProps = {
  row: TreeItem
  selected?: boolean
  /** The keyboard cursor (aria-activedescendant points here). */
  focused?: boolean
  /** The element id the tree's aria-activedescendant names. */
  domId?: string
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onToggle?: () => void
}

/** One 22px row (DESIGN-W13 §12): indent guides, twistie, icon, label, dim description, then badge / decoration,
 *  which the hover actions replace. A `treeitem`; `Tree` renders these. Depth 0 with no children is a list row. */
export function TreeRow({ row, selected, focused, domId, onClick, onDoubleClick, onContextMenu, onToggle }: TreeRowProps): React.JSX.Element {
  return (
    <div
      id={domId}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={!!selected}
      aria-expanded={row.hasChildren ? !!row.expanded : undefined}
      title={row.title}
      className={cx('ui-tree__row', selected && 'is-selected', focused && 'is-focused')}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {row.depth > 0 && <span className="ui-tree__indent" style={{ width: row.depth * 8 }} aria-hidden="true" />}
      <span
        className={cx('ui-tree__twistie', row.hasChildren && row.expanded && 'is-open')}
        aria-hidden="true"
        onClick={
          row.hasChildren
            ? (e) => {
                e.stopPropagation()
                onToggle?.()
              }
            : undefined
        }
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {row.hasChildren && <ChevronRight size={16} />}
      </span>
      {row.icon && <span className="ui-tree__icon">{row.icon}</span>}
      <span className="ui-tree__label">{row.label}</span>
      {row.description && <span className="ui-tree__desc">{row.description}</span>}
      {(row.badge || row.decoration) && (
        <span className={cx('ui-tree__meta', !!row.actions && 'has-actions')}>
          {row.decoration && (
            <span className={cx('ui-tree__deco', row.decoration.tone && `ui-tree__deco--${row.decoration.tone}`)}>
              {row.decoration.icon}
              {row.decoration.text}
            </span>
          )}
          {row.badge}
        </span>
      )}
      {row.actions && (
        <span className="ui-tree__actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {row.actions}
        </span>
      )}
    </div>
  )
}

export type TreeProps = {
  /** The visible rows, flattened: parents before their children, collapsed subtrees left out. */
  rows: TreeItem[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** A parent's twistie, or Right/Left on it: `expanded` is the state asked for. */
  onToggle?: (id: string, expanded: boolean) => void
  /** Enter or double-click. */
  onOpen?: (id: string) => void
  /** Right-click, Shift+F10 or the ContextMenu key on a row; pass `e` to `menuPointOf`. The row is selected first. */
  onContextMenu?: (id: string, e: React.MouseEvent) => void
  /** aria-label of the tree. */
  label: string
  className?: string
}

/** An ARIA tree (DESIGN-W13 §12). Focus stays on the tree; aria-activedescendant names the cursor row, which the
 *  selection follows as in VSCode. Keys: Up/Down, Left/Right collapse / expand / parent, Home/End, Enter opens,
 *  type-ahead. Past 200 rows only the viewport is drawn. The tree scrolls: give it a height (flex: 1 in a ViewPane). */
export function Tree({ rows, selectedId, onSelect, onToggle, onOpen, onContextMenu, label, className }: TreeProps): React.JSX.Element {
  const base = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [view, setView] = useState({ top: 0, h: TREE_DEFAULT_VIEWPORT_H })
  const typed = useRef({ text: '', at: 0 })

  const cursorId = cursor !== null && rows.some((r) => r.id === cursor) ? cursor : (selectedId ?? null)
  const current = cursorId === null ? -1 : rows.findIndex((r) => r.id === cursorId)
  const { start, end } = treeWindow(rows.length, view.top, view.h)
  const virtual = start > 0 || end < rows.length
  const domId = (i: number): string => `${base}-r${i}`

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setView((v) => (v.h === el.clientHeight ? v : { ...v, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // keep the cursor row in view as the keys move it
  useEffect(() => {
    const el = ref.current
    if (!el || current < 0) return
    const top = treeRevealTop(current, el.scrollTop, el.clientHeight || view.h)
    if (top !== el.scrollTop) el.scrollTop = top
  }, [current, view.h])

  const moveTo = (i: number): void => {
    const r = rows[i]
    if (!r) return
    setCursor(r.id)
    onSelect?.(r.id)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (isTypeaheadKey(e)) {
      const now = Date.now()
      const text = typeaheadBuffer(typed.current.text, typed.current.at, e.key, now)
      typed.current = { text, at: now }
      const hit = treeTypeahead(rows.map((r) => r.label), text, current)
      if (hit >= 0) {
        e.preventDefault()
        moveTo(hit)
      }
      return
    }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') return // the native contextmenu event follows
    const action = treeKeyAction(rows, current, e.key)
    if (action === null) return
    e.preventDefault()
    if ('focus' in action) moveTo(action.focus)
    else if ('toggle' in action) onToggle?.(rows[action.toggle].id, action.expand)
    else onOpen?.(rows[action.open].id)
  }

  const onScroll = (): void => {
    const el = ref.current
    if (el) setView({ top: el.scrollTop, h: el.clientHeight || view.h })
  }

  const items = rows.slice(start, end).map((row, k) => {
    const i = start + k
    return (
      <TreeRow
        key={row.id}
        row={row}
        domId={domId(i)}
        selected={row.id === selectedId}
        focused={i === current}
        onClick={() => {
          moveTo(i)
          ref.current?.focus()
        }}
        onDoubleClick={() => onOpen?.(row.id)}
        onContextMenu={
          onContextMenu &&
          ((e) => {
            moveTo(i)
            onContextMenu(row.id, e)
          })
        }
        onToggle={() => onToggle?.(row.id, !row.expanded)}
      />
    )
  })

  return (
    <div
      ref={ref}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={current >= start && current < end ? domId(current) : undefined}
      className={cx('ui-tree', className)}
      onKeyDown={onKeyDown}
      onScroll={rows.length > TREE_VIRTUAL_AFTER ? onScroll : undefined}
      onFocus={() => current < 0 && rows.length > 0 && setCursor(rows[0].id)}
      // Shift+F10 / the ContextMenu key fire on the focused tree itself: the menu is for the cursor row
      onContextMenu={
        onContextMenu &&
        ((e) => {
          if (e.target === e.currentTarget && current >= 0) onContextMenu(rows[current].id, e)
        })
      }
    >
      {virtual ? (
        <div style={{ height: rows.length * TREE_ROW_H, position: 'relative' }}>
          <div style={{ transform: `translateY(${start * TREE_ROW_H}px)` }}>{items}</div>
        </div>
      ) : (
        items
      )}
    </div>
  )
}
