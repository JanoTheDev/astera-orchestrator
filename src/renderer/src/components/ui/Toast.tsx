import { useEffect, useState } from 'react'
import { dismiss, pauseTimers, resumeTimers, subscribe, type Toast as ToastData } from '../../lib/toast'
import { useI18n } from '../../i18n/I18nProvider'
import { Button } from './UiButton'
import { IconButton } from './IconButton'
import { Icon, type IconName } from './Icon'
import { cx } from './logic'

const KIND_ICON: Record<ToastData['kind'], IconName> = { info: 'info', success: 'done', error: 'error' }

/** One toast: a kind icon (the second cue beside the edge colour), the message, the action if it has one, and a named
 *  close button. An action toast never auto-dismisses (lib/toast), so the close button is always there to ignore it. */
export function Toast({ toast, dismissLabel, onDismiss }: { toast: ToastData; dismissLabel: string; onDismiss: () => void }): React.JSX.Element {
  return (
    <div className={cx('ui-toast', `ui-toast--${toast.kind}`)}>
      <Icon name={KIND_ICON[toast.kind]} size={16} className="ui-toast__icon" />
      <span className="ui-toast__msg">{toast.message}</span>
      {toast.action && (
        <Button size="sm" variant="primary" className="ui-toast__action" onClick={toast.action.onClick}>
          {toast.action.label}
        </Button>
      )}
      <IconButton size="sm" icon={<Icon name="close" size={14} />} label={dismissLabel} onClick={onDismiss} />
    </div>
  )
}

/** Where toasts show — mounted exactly once, at App's root. It only subscribes to the store (lib/toast), so whoever
 *  wants to notify calls toast.error(...) from anywhere. A polite live region; while the pointer or focus is on it the
 *  auto-dismiss timers hold. */
export function ToastViewport(): React.JSX.Element {
  const { t } = useI18n()
  const [items, setItems] = useState<ToastData[]>([])

  useEffect(() => subscribe(setItems), [])
  // a toast that closes under the pointer must not leave the timers held
  useEffect(() => {
    if (items.length === 0) resumeTimers()
  }, [items.length])

  return (
    <section
      className="ui-toast-viewport"
      role="status"
      aria-live="polite"
      onMouseEnter={pauseTimers}
      onMouseLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) resumeTimers()
      }}
      onFocus={pauseTimers}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !e.currentTarget.matches(':hover')) resumeTimers()
      }}
    >
      {items.map((item) => (
        <Toast key={item.id} toast={item} dismissLabel={t('common.toastDismiss')} onDismiss={() => dismiss(item.id)} />
      ))}
    </section>
  )
}
