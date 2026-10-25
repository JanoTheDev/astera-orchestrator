import { useEffect, type RefObject } from 'react'

const LINE_PX = 16

/** How far a wheel event should move a row sideways, or null to leave the event to the browser. Only a mostly-vertical
 *  wheel is turned sideways; a trackpad's sideways swipe already scrolls the row natively. `deltaMode` 1 is lines, 2 pages. */
export function wheelScrollDelta(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  el: { scrollWidth: number; clientWidth: number }
): number | null {
  if (el.scrollWidth <= el.clientWidth) return null
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return null
  if (e.deltaMode === 1) return e.deltaY * LINE_PX
  if (e.deltaMode === 2) return e.deltaY * el.clientWidth
  return e.deltaY
}

/** A vertical mouse wheel over the element scrolls it sideways (Chromium only does that on Shift+wheel). A native
 *  listener, because React's wheel handler is passive and cannot preventDefault. */
export function useWheelScrollX(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const dx = wheelScrollDelta(e, el)
      if (dx === null) return
      el.scrollLeft += dx
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }) // every render: the element can mount later than the component (BottomPanel's list shows only on the terminal tabs)
}
