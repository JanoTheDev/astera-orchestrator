// Open and close animation for the overlay primitives (Modal, Popover, Menu, Toast, and the command bar through Modal).
// One module owns the timing so every surface moves alike:
//   DUR / DUR_FAST / EASE   mirror --dur (150ms), --dur-fast (90ms) and --ease-out in styles/tokens.css
//   fade    opacity only                  scrims, plain panels
//   rise    opacity + 4px rise            modal box, popover panel, toast
//   scale   opacity + 0.96 -> 1 scale     menus (grow out of their trigger)
//   height  opacity + height 0 -> auto    collapsible side-bar sections (ViewPane bodies)
// Reduced motion (prefers-reduced-motion: reduce) keeps opacity and drops every transform and height change.
// `useOpenClose(ref, preset)` plays the preset when the element mounts and, when it unmounts, plays it backwards on a
// clone left in its place, so callers that unmount on `open && ...` (all of Modal's callers) need no change.
import { animate } from 'motion/react'
import { useLayoutEffect, type RefObject } from 'react'

export const DUR = 0.15
export const DUR_FAST = 0.09
export const EASE: [number, number, number, number] = [0.2, 0.6, 0.3, 1]

export type MotionPreset = 'fade' | 'rise' | 'scale' | 'height'

type Hidden = { opacity: number; y?: number; scale?: number; height?: number }

const HIDDEN: Record<MotionPreset, Hidden> = {
  fade: { opacity: 0 },
  rise: { opacity: 0, y: 4 },
  scale: { opacity: 0, scale: 0.96 },
  height: { opacity: 0, height: 0 }
}

/** The start (= end of the exit) state of a preset; under reduced motion only the opacity is left. */
export function presetFor(preset: MotionPreset, reduced: boolean): Hidden {
  return reduced ? { opacity: 0 } : HIDDEN[preset]
}

const reducedNow = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** Motion keyframes between the hidden state and the shown one (`from` the shown state when leaving). */
function keyframes(el: HTMLElement, preset: MotionPreset, leaving: boolean): Record<string, Array<number | string>> {
  const out: Record<string, Array<number | string>> = {}
  for (const [k, hidden] of Object.entries(presetFor(preset, reducedNow()))) {
    const shown = k === 'opacity' ? 1 : k === 'scale' ? 1 : k === 'height' ? (leaving ? `${el.offsetHeight}px` : 'auto') : 0
    out[k] = leaving ? [shown, hidden] : [hidden, shown]
  }
  return out
}

const opts = { duration: DUR, ease: EASE } as const

/** Plays the preset in on mount; on unmount plays it out on a clone that replaces the element, then removes the clone.
 *  `inner` plays a second preset on a child of the same clone (Modal: the backdrop fades while the box rises). */
export function useOpenClose(ref: RefObject<HTMLElement | null>, preset: MotionPreset, inner?: { selector: string; preset: MotionPreset }): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const born = performance.now()
    animate(el, keyframes(el, preset, false), opts)
    const box = inner ? el.querySelector<HTMLElement>(inner.selector) : null
    if (box && inner) animate(box, keyframes(box, inner.preset, false), opts)
    return () => {
      // StrictMode's dev-only unmount + remount runs in the same tick: that is no close
      if (performance.now() - born < 16 || !el.isConnected) return
      const ghost = el.cloneNode(true) as HTMLElement
      ghost.removeAttribute('id')
      ghost.inert = true
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.pointerEvents = 'none'
      el.after(ghost)
      const ghostBox = inner ? ghost.querySelector<HTMLElement>(inner.selector) : null
      if (ghostBox && inner) animate(ghostBox, keyframes(ghostBox, inner.preset, true), opts)
      animate(ghost, keyframes(el, preset, true), opts).then(() => ghost.remove())
    }
  }, [ref, preset, inner])
}
