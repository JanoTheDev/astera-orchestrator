import { X } from 'lucide-react'
import { cx } from './logic'
import { IconButton } from './IconButton'

export type EditorTabProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect' | 'children'> & {
  label: React.ReactNode
  /** A 16px lucide element. */
  icon?: React.ReactNode
  /** Dim text after the label (a folder, a task). */
  description?: React.ReactNode
  active?: boolean
  /** The active tab of the focused group draws the 2px top border; elsewhere it is 1px (an unfocused group: none). */
  groupFocused?: boolean
  /** A dot in the close button's place until hover: unsaved or live. */
  dirty?: boolean
  onSelect?: () => void
  /** The close button and middle-click; without it the tab cannot be closed. */
  onClose?: () => void
  /** aria-label of the close button (the caller's i18n); required with `onClose`. */
  closeLabel?: string
}

/** A 35px editor tab (DESIGN-W13 §5): icon, label, dim description, then a close button shown on hover and on the
 *  active tab; a dirty tab shows a dot there until hover. Middle-click closes. `role="tab"`: put it in a tablist.
 *  Extra div props (draggable, drag handlers, tabIndex, title) pass through. */
export function EditorTab({ label, icon, description, active = false, groupFocused = true, dirty = false, onSelect, onClose, closeLabel, className, ...rest }: EditorTabProps): React.JSX.Element {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={cx('ui-etab', active && 'is-active', active && groupFocused && 'is-focused-group', active && !groupFocused && 'is-blurred-group', dirty && 'is-dirty', className)}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.()
        } else if (e.key === 'Delete' && onClose) {
          e.preventDefault()
          onClose()
        }
      }}
      // middle button: stop the autoscroll cursor on press, close on release
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault()
          onClose()
        }
      }}
      {...rest}
    >
      {icon && <span className="ui-etab__icon">{icon}</span>}
      <span className="ui-etab__label">{label}</span>
      {description && <span className="ui-etab__desc">{description}</span>}
      {onClose ? (
        <span className="ui-etab__end">
          {dirty && <span className="ui-etab__dot" aria-hidden="true" />}
          <IconButton
            size="sm"
            tabIndex={-1}
            className="ui-etab__close"
            icon={<X size={16} />}
            label={closeLabel ?? ''}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          />
        </span>
      ) : (
        dirty && (
          <span className="ui-etab__end">
            <span className="ui-etab__dot" aria-hidden="true" />
          </span>
        )
      )}
    </div>
  )
}
