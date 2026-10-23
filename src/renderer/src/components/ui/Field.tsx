import { useId } from 'react'
import { cx } from './logic'
import { Input, Textarea } from './Inputs'
import { Select, type SelectChange, type SelectOption } from './Select'
import { Switch } from './Switch'

type Base = { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; className?: string }

export type FieldProps = Base &
  (
    | ({ kind?: 'text' } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>)
    | ({ kind: 'number' } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>)
    | ({ kind: 'textarea' } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>)
    | { kind: 'select'; options: SelectOption[]; value?: string; onChange?: (e: SelectChange) => void; id?: string; disabled?: boolean; placeholder?: string; required?: boolean }
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
    input = <Textarea {...rest} {...aria} />
  } else if (control.kind === 'select') {
    // `required` has no native check on the listbox; the form's own error line says what is missing
    const { kind: _k, options, onChange, required: _r, value, ...rest } = control
    input = <Select {...rest} {...aria} value={value ?? ''} items={options} onChange={(v) => onChange?.({ target: { value: v } })} />
  } else if (control.kind === 'toggle') {
    const { kind: _k, checked, onChange, ...rest } = control
    input = (
      <Switch {...rest} {...aria} checked={checked} onChange={onChange} />
    )
  } else if (control.kind === 'number') {
    const { kind: _k, ...rest } = control
    input = <Input type="number" {...rest} {...aria} />
  } else {
    const { kind: _k, ...rest } = control
    input = <Input type="text" {...rest} {...aria} />
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
