import { forwardRef, useEffect, useRef } from 'react'
import { cx } from './logic'

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean
  /** Absent for a read-only box (a rendered task list); the box then only shows `checked`. */
  onChange?: (checked: boolean) => void
  /** The "some of them" state of a select-all box. Visual only; `checked` still says what a click does next. */
  indeterminate?: boolean
  /** The text beside the box: wraps both in one <label>, so a click on the text toggles it. Without it, name the box
   *  with a wrapping <label>, a <label htmlFor> or `aria-label`. */
  label?: React.ReactNode
}

/** A choice applied later with a form (a switch takes effect at once). The box is the token-styled native checkbox
 *  (styles/select.css), so Space toggles it and :focus-visible draws the token focus ring. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onChange, indeterminate = false, label, className, ...rest },
  ref
) {
  const own = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (own.current) own.current.indeterminate = indeterminate
  }, [indeterminate, checked])
  const box = (
    <input
      ref={(el) => {
        own.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      type="checkbox"
      className={cx('ui-check', className)}
      {...rest}
      checked={checked}
      onChange={(e) => onChange?.(e.target.checked)}
    />
  )
  return label == null ? (
    box
  ) : (
    <label className="check-small">
      {box}
      {label}
    </label>
  )
})
