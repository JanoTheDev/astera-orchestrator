import { cx } from './logic'

/** A placeholder block while content loads: a token-coloured shimmer, still under reduced motion. Hidden from screen
 *  readers — mark the region that is loading with aria-busy instead. `width`/`height` take any CSS length.
 *  The file is UiSkeleton.tsx: Skeleton.tsx would be the same file as shadcn's skeleton.tsx on macOS/Windows. */
export function Skeleton({
  shape = 'line',
  width,
  height,
  className
}: {
  /** line: one text line (default); block: a card or image; circle: an avatar. */
  shape?: 'line' | 'block' | 'circle'
  width?: number | string
  height?: number | string
  className?: string
}): React.JSX.Element {
  return <span aria-hidden="true" className={cx('ui-skeleton', `ui-skeleton--${shape}`, className)} style={{ width, height }} />
}
