import { cx } from './logic'

/** A CSS-only hover/focus tooltip around one control. For plain text on an icon button, IconButton's `label` (title) is enough;
 *  use this when the hint carries more (a shortcut, a second line). */
export function Tooltip({ content, side = 'bottom', className, children }: { content: React.ReactNode; side?: 'top' | 'bottom'; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={cx('ui-tip', `ui-tip--${side}`, className)}>
      {children}
      <span className="ui-tip__body" role="tooltip">
        {content}
      </span>
    </span>
  )
}
