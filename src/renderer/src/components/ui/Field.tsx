import { useId } from 'react'
import { cx } from './logic'

type Base = { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; className?: string }

export type FieldProps = Base &
  (
    | ({ kind?: 'text' } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>)
    | ({ kind: 'number' } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>)
    | ({ kind: 'textarea' } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>)
    | ({ kind: 'select'; options: Array<{ value: string; label: React.ReactNode }> } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>)
    | ({ kind: 'toggle'; checked: boolean; onChange: (checked: boolean) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type' | 'checked' | 'onChange'>)
  )

/** The ids that tie a field's hint and error to its control (aria-describedby), in that order. */
export function describedBy(id: string, hint: boolean, error: boolean): string | undefined {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
}

/** A labelled form control (text, number, textarea, select, toggle) with an optional hint and error. */
export function Field(props: FieldProps): React.JSX.Element {
  const { label, hint, error, className, ...control } = props
  const auto = useId()
  const id = control.id ?? auto
  const aria = { id, 'aria-describedby': describedBy(id, hint != null, error != null), 'aria-invalid': error != null || undefined }
  let input: React.ReactNode
  if (control.kind === 'textarea') {
    const { kind: _k, ...rest } = control
    input = <textarea className="ui-field__control" {...rest} {...aria} />
  } else if (control.kind === 'select') {
    const { kind: _k, options, ...rest } = control
    input = (
      <select className="ui-field__control" {...rest} {...aria}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (control.kind === 'toggle') {
    const { kind: _k, checked, onChange, ...rest } = control
    input = (
      <input type="checkbox" role="switch" className="ui-toggle" {...rest} {...aria} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    )
  } else if (control.kind === 'number') {
    const { kind: _k, ...rest } = control
    input = <input type="number" className="ui-field__control" {...rest} {...aria} />
  } else {
    const { kind: _k, ...rest } = control
    input = <input type="text" className="ui-field__control" {...rest} {...aria} />
  }
  return (
    <div className={cx('ui-field', control.kind === 'toggle' && 'ui-field--toggle', error != null && 'ui-field--error', className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      {input}
      {hint != null && (
        <p id={`${id}-hint`} className="ui-field__hint">
          {hint}
        </p>
      )}
      {error != null && (
        <p id={`${id}-error`} className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
