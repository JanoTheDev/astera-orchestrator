import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { backdropProps } from '../../lib/backdrop'
import { Button } from './UiButton'
import { FOCUSABLE, modalKeyAction } from './logic'

export type ModalSize = 'sm' | 'md' | 'lg'

export type ModalProps = {
  title: React.ReactNode
  onClose: () => void
  size?: ModalSize
  footer?: React.ReactNode
  /** aria-label of the close button (the caller's i18n). */
  closeLabel?: string
  children: React.ReactNode
}

/** A modal dialog: drag-safe backdrop close, Esc closes, Tab is trapped inside, focus goes back to the opener on close. */
export function Modal({ title, onClose, size = 'md', footer, closeLabel = 'Close', children }: ModalProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const box = ref.current
    const first = box?.querySelector<HTMLElement>(`.ui-modal__body ${FOCUSABLE}`) ?? box
    first?.focus()
    return () => opener?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const action = modalKeyAction(e.key, e.shiftKey, items.indexOf(document.activeElement as HTMLElement), items.length)
    if (action === null) return
    e.preventDefault()
    e.stopPropagation()
    if (action === 'close') close.current()
    else (items[action.focus] ?? ref.current)?.focus()
  }

  return (
    <div className="ui-modal-backdrop" {...backdropProps(onClose)}>
      <div ref={ref} className={`ui-modal ui-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="ui-modal__head">
          <h2 id={titleId} className="ui-modal__title">
            {title}
          </h2>
          <Button icon={<X size={16} aria-hidden="true" />} aria-label={closeLabel} onClick={onClose} />
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer && <footer className="ui-modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}
