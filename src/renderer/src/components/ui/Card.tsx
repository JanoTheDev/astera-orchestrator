import { cx } from './logic'

export type CardTone = 'plain' | 'focus' | 'need' | 'danger'

export type CardProps = { tone?: CardTone; className?: string; children: React.ReactNode } & (
  | { onClick?: undefined }
  | ({ onClick: (e: React.MouseEvent<HTMLButtonElement>) => void } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'children'>)
)

/** A card; given onClick it renders as a <button> so it is reachable and pressable by keyboard. */
export function Card({ tone = 'plain', className, children, ...rest }: CardProps): React.JSX.Element {
  const cls = cx('ui-card', `ui-card--${tone}`, rest.onClick && 'ui-card--clickable', className)
  if (rest.onClick)
    return (
      <button type="button" className={cls} {...rest}>
        {children}
      </button>
    )
  return <div className={cls}>{children}</div>
}
