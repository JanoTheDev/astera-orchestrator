import { useRef, useState } from 'react'
import { cx, sashKeyDelta, sashSize } from './logic'

export type SashProps = {
  /** `vertical`: a bar between left and right that resizes a width; `horizontal`: between top and bottom, a height. */
  orientation: 'vertical' | 'horizontal'
  /** The current size of the pane this handle resizes, in px. */
  size: number
  min: number
  max: number
  /** The handle sits on the pane's leading edge: dragging toward the pane grows it (a bottom panel, a right side bar). */
  reverse?: boolean
  /** Every frame while dragging (rAF-throttled) and on each arrow key. */
  onResize: (px: number) => void
  /** Once, when the drag ends or after an arrow key: the moment to persist the size. */
  onResizeEnd?: (px: number) => void
  /** aria-label (the caller's i18n). */
  label: string
  className?: string
}

/** A resize handle (DESIGN-W13 §2): a 4px hit area that shows a 1px --focus-border while hovered or dragged.
 *  Pointer drag with pointer capture, one update per frame, clamped to [min, max]; arrow keys step 8px.
 *  `role="separator"` with its value. The caller lays it out between the two panes. */
export function Sash({ orientation, size, min, max, reverse = false, onResize, onResizeEnd, label, className }: SashProps): React.JSX.Element {
  const drag = useRef<{ start: number; from: number; latest: number; raf: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pos = (e: React.PointerEvent): number => (orientation === 'vertical' ? e.clientX : e.clientY)
  const sizeAt = (d: NonNullable<typeof drag.current>): number => sashSize(d.from, d.latest - d.start, min, max, reverse)
  const bodyClass = orientation === 'vertical' ? 'resizing-col' : 'resizing-row'

  const end = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.raf) cancelAnimationFrame(d.raf)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    document.body.classList.remove(bodyClass)
    setDragging(false)
    const px = sizeAt(d)
    onResize(px)
    onResizeEnd?.(px)
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cx('ui-sash', `ui-sash--${orientation}`, dragging && 'is-dragging', className)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = { start: pos(e), from: size, latest: pos(e), raf: 0 }
        document.body.classList.add(bodyClass)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.latest = pos(e)
        if (!d.raf)
          d.raf = requestAnimationFrame(() => {
            d.raf = 0
            onResize(sizeAt(d))
          })
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const delta = sashKeyDelta(e.key, orientation)
        if (delta === 0) return
        e.preventDefault()
        const px = sashSize(size, delta, min, max, reverse)
        onResize(px)
        onResizeEnd?.(px)
      }}
    />
  )
}
