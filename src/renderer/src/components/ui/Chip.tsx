import { cx } from './logic'

export type ChipTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'

export function Chip({ tone = 'neutral', dot = false, className, children }: { tone?: ChipTone; dot?: boolean; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={cx('ui-chip', `ui-chip--${tone}`, className)}>
      {dot && <span className="ui-chip__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
