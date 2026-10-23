import { useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { Button } from './UiButton'

export type ConfirmDialogProps = {
  title: React.ReactNode
  /** The question's detail, and anything asked with it (choices). */
  children?: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  /** aria-label of the header's close button. */
  closeLabel?: string
  /** A destructive action: the confirm button is the danger variant. */
  danger?: boolean
  onConfirm: () => void
  /** The Cancel button. */
  onCancel: () => void
  /** Esc, the backdrop and the header ✕; defaults to onCancel. */
  onDismiss?: () => void
}

/** A yes/no question on ui/Modal. The confirm button takes focus, so Enter confirms; Esc, the backdrop and ✕ dismiss.
 *  For app code, `await confirmModal({...})` (lib/confirm) shows this through ConfirmHost; render it directly only for a
 *  confirmation the store cannot express. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  closeLabel,
  danger = false,
  onConfirm,
  onCancel,
  onDismiss
}: ConfirmDialogProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Modal focuses the first control in the body; the confirm button (in the footer) must have it so Enter confirms.
  // This effect runs after Modal's, since ConfirmDialog is its parent.
  useEffect(() => confirmRef.current?.focus(), [])
  return (
    <Modal
      title={title}
      onClose={onDismiss ?? onCancel}
      size="sm"
      closeLabel={closeLabel}
      footer={
        <>
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
