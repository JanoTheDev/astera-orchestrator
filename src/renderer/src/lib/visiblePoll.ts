// A poll that asks nothing while the window is hidden (performance audit R2): `load` runs now, every `ms` while the
// document is shown, and once as soon as it shows again or the window takes focus (a window brought back to the front
// reads what changed while the owner was elsewhere, rather than at its next turn). Returns the stop.
export function pollWhileVisible(
  load: () => void,
  ms: number,
  doc: EventTarget & { hidden: boolean } = document,
  /** Where 'focus' is heard: the window when `doc` is the real document, none otherwise (a test's fake). */
  focus: EventTarget | null = typeof window !== 'undefined' && typeof document !== 'undefined' && doc === document ? window : null
): () => void {
  let stopped = false
  const tick = (): void => {
    if (!stopped && !doc.hidden) load()
  }
  const onVisibility = (): void => {
    if (!doc.hidden) tick()
  }
  load()
  const timer = setInterval(tick, ms)
  doc.addEventListener('visibilitychange', onVisibility)
  focus?.addEventListener('focus', tick)
  return () => {
    stopped = true
    clearInterval(timer)
    doc.removeEventListener('visibilitychange', onVisibility)
    focus?.removeEventListener('focus', tick)
  }
}
