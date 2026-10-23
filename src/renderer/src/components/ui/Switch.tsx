import { forwardRef } from 'react'
import { cx } from './logic'

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean
  onChange: (checked: boolean) => void
}

/** An on/off setting that takes effect at once (role=switch). Space toggles it (a native checkbox underneath).
 *  Name it: a <label htmlFor>, a wrapping <label>, or `aria-label`. For a choice applied later with a form, use a checkbox. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ checked, onChange, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      className={cx('ui-toggle', className)}
      {...rest}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
})
