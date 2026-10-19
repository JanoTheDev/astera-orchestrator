import { cx } from './logic'

/** A key chord as the person types it ("Ctrl+K"). Each `+`-separated key gets its own cap. */
export function Kbd({ children, className }: { children: string; className?: string }): React.JSX.Element {
  return (
    <span className={cx('ui-kbd', className)}>
      {children.split('+').map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}
