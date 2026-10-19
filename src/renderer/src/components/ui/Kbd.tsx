import { cx } from './logic'

/** The caps of a chord: "Ctrl+K" -> Ctrl, K; a literal plus key survives ("Ctrl++" -> Ctrl, +). */
export function kbdKeys(chord: string): string[] {
  return chord.split(/\+(?!$)/).map((k) => k || '+')
}

/** A key chord as the person types it ("Ctrl+K"). Each `+`-separated key gets its own cap. */
export function Kbd({ children, className }: { children: string; className?: string }): React.JSX.Element {
  return (
    <span className={cx('ui-kbd', className)}>
      {kbdKeys(children).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}
