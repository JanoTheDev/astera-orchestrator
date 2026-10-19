import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from './logic'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon; the spinner takes its place while loading. With no children the button is a 30px icon-only ghost (give it aria-label). */
  icon?: React.ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = 'md', icon, loading = false, disabled, className, children, type = 'button', ...rest },
  ref
) {
  const iconOnly = children == null || children === false
  const v = variant ?? (iconOnly ? 'ghost' : 'secondary')
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ui-btn', `ui-btn--${v}`, `ui-btn--${size}`, iconOnly && 'ui-btn--icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 14 : 16} className="ui-spin" aria-hidden="true" /> : icon}
      {!iconOnly && <span className="ui-btn__label">{children}</span>}
    </button>
  )
})
