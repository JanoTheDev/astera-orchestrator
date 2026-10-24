// Windowing for long lists: the rows to draw for a scroll position, and a hook that keeps that window for a list
// inside a scrolling ancestor. Rows may differ in height (a Task row grows when it expands): the hook measures the
// rows it has drawn and estimates the rest, and two padding values stand in for the rows left out. Pure maths up top,
// so the renderer tests (node, no DOM) can pin it down; FileExplorer's fixed-height tree uses `visibleRange` too.
import { useLayoutEffect, useRef, useState } from 'react'

/** A list longer than this many rows is windowed; a shorter one is drawn whole, as before. */
export const VIRTUAL_AFTER_ROWS = 100
/** Rows drawn beyond each edge of the viewport, so a fast scroll does not show blank space first */
export const VIRTUAL_OVERSCAN = 6
/** The viewport height assumed before the list has been measured (the first render) */
export const VIRTUAL_DEFAULT_VIEWPORT_H = 600

/** Row tops as a running sum of the heights: offsets[i] is row i's top, offsets[n] the list's height. */
export function offsetsOf(heights: readonly number[]): number[] {
  const out = new Array<number>(heights.length + 1)
  let y = 0
  for (let i = 0; i < heights.length; i++) {
    out[i] = y
    y += heights[i]
  }
  out[heights.length] = y
  return out
}

/** First index i in [0, n] with offsets[i] > y (offsets ascending) */
function firstAbove(offsets: readonly number[], y: number, n: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] > y) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** The rows to draw, [start, end): those overlapping [scrollTop, scrollTop + viewportH), widened by
 *  overscan rows on each side */
export function visibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportH: number,
  overscan: number
): { start: number; end: number } {
  const n = offsets.length - 1
  if (n <= 0) return { start: 0, end: 0 }
  // the first row whose bottom is below scrollTop: bottoms are offsets[1..n]
  const first = Math.min(n, firstAbove(offsets, scrollTop, n + 1) - 1)
  // the first row whose top is at or past the viewport's bottom
  const bottom = scrollTop + viewportH
  let past = firstAbove(offsets, bottom - 1e-9, n + 1)
  past = Math.min(n, Math.max(first + 1, past))
  return { start: Math.max(0, first - overscan), end: Math.min(n, past + overscan) }
}

/** The rows to draw for a list whose top is `y` above the viewport's top (negative: the list starts below it).
 *  A list wholly outside the viewport draws nothing. */
export function listWindow(
  offsets: readonly number[],
  y: number,
  viewportH: number,
  overscan: number
): { start: number; end: number } {
  const total = offsets[offsets.length - 1] ?? 0
  if (total <= 0 || y >= total || y + viewportH <= 0) return { start: 0, end: 0 }
  return visibleRange(offsets, y, viewportH, overscan)
}

/** The height of the rows left out before and after the window: the padding that keeps the scrollbar true. */
export function windowPads(offsets: readonly number[], range: { start: number; end: number }): { before: number; after: number } {
  const total = offsets[offsets.length - 1] ?? 0
  return { before: offsets[range.start] ?? 0, after: total - (offsets[range.end] ?? total) }
}

/** The nearest ancestor that scrolls, or null when the page itself does. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll' || o === 'overlay') return p
  }
  return null
}

export type VirtualRows<E extends HTMLElement> = {
  /** Goes on the element that holds the rows, so the hook can tell where the list starts. */
  listRef: React.RefObject<E | null>
  /** The rows to draw: keys[start..end) */
  start: number
  end: number
  /** The height of the rows left out before and after: padding of the list element. */
  before: number
  after: number
  /** The ref of a drawn row: its height replaces the estimate. */
  measure: (key: string) => (el: HTMLElement | null) => void
  /** Scrolls a row that is not drawn into the window (one that is drawn is the caller's to scroll to). */
  revealKey: (key: string) => void
}

/** The window of `keys` (one per row) for the list in `listRef`, inside its scrolling ancestor. `estimate` is a row's
 *  height until it has been drawn once. Not `enabled`: every row is drawn and nothing is observed. */
export function useVirtualRows<E extends HTMLElement>(keys: readonly string[], estimate: (index: number) => number, enabled: boolean): VirtualRows<E> {
  const listRef = useRef<E>(null)
  const heights = useRef(new Map<string, number>())
  const [, setTick] = useState(0)
  const [view, setView] = useState({ y: 0, h: VIRTUAL_DEFAULT_VIEWPORT_H })
  const on = useRef(enabled)
  const observer = useRef<ResizeObserver | null>(null)
  const keyOf = useRef(new WeakMap<Element, string>())
  const nodes = useRef(new Map<string, HTMLElement>())
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>())

  useLayoutEffect(() => {
    on.current = enabled
    const list = listRef.current
    if (!enabled || !list) return
    const scroller = scrollParentOf(list)
    let raf = 0
    const read = (): void => {
      raf = 0
      const top = scroller ? scroller.getBoundingClientRect().top : 0
      const h = scroller ? scroller.clientHeight : window.innerHeight
      const y = Math.round(top - list.getBoundingClientRect().top)
      setView((v) => (v.y === y && v.h === h ? v : { y, h }))
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', schedule, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(scroller ?? document.documentElement)
    ro?.observe(list)
    return () => {
      target.removeEventListener('scroll', schedule)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [enabled])

  useLayoutEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
    },
    []
  )

  const measure = (key: string): ((el: HTMLElement | null) => void) => {
    let cb = refs.current.get(key)
    if (!cb) {
      cb = (el) => {
        const prev = nodes.current.get(key)
        if (prev && prev !== el) observer.current?.unobserve(prev)
        if (!el) {
          nodes.current.delete(key)
          return
        }
        nodes.current.set(key, el)
        keyOf.current.set(el, key)
        if (!observer.current && typeof ResizeObserver !== 'undefined') {
          observer.current = new ResizeObserver((entries) => {
            let changed = false
            for (const e of entries) {
              const k = keyOf.current.get(e.target)
              const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).offsetHeight
              if (k !== undefined && h > 0 && heights.current.get(k) !== h) {
                heights.current.set(k, h)
                changed = true
              }
            }
            if (changed && on.current) setTick((n) => n + 1)
          })
        }
        observer.current?.observe(el)
      }
      refs.current.set(key, cb)
    }
    return cb
  }

  const offsets = offsetsOf(keys.map((k, i) => heights.current.get(k) ?? estimate(i)))
  const { start, end } = enabled ? listWindow(offsets, view.y, view.h, VIRTUAL_OVERSCAN) : { start: 0, end: keys.length }
  const { before, after } = enabled ? windowPads(offsets, { start, end }) : { before: 0, after: 0 }

  const revealKey = (key: string): void => {
    const i = keys.indexOf(key)
    const list = listRef.current
    if (!enabled || !list || i < 0 || (i >= start && i < end)) return
    // a third of the way down, and the window is moved with the scroll so the row is drawn before the next paint
    const delta = Math.round(offsets[i] - view.y - view.h / 3)
    const scroller = scrollParentOf(list)
    if (scroller) scroller.scrollTop += delta
    else window.scrollBy(0, delta)
    setView({ y: view.y + delta, h: view.h })
  }

  return { listRef, start, end, before, after, measure, revealKey }
}
