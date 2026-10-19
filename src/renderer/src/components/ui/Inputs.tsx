import { forwardRef } from 'react'
import { cx } from './logic'

// Thin, styled wrappers of the native controls (DESIGN-W11 §10). One file: `Textarea.tsx` would clash with
// shadcn's textarea.tsx on case-insensitive file systems.

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/** A text-like <input> (text, number, search, password…). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={cx('ui-input', className)} {...rest} />
})

/** A native <select> with the house chevron; options are its children. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx('ui-select', className)} {...rest} />
})

/** A multi-line <textarea>, resizable in height. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('ui-textarea', className)} {...rest} />
})
