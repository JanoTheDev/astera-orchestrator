// W5-C: what closes the open command bar besides its own button. Before this it closed only on Escape with focus
// inside it, or on its shortcut again, so after a click into a terminal there was no way out.
//
// Listens on `target` (the window) in the capture phase, so it hears a pointer or a key wherever focus is. While the
// app's confirmation dialog is up (one the bar may have opened) neither closes it: the dialog's own Escape cancels the
// dialog, and a click on it is not a click away from the bar.
export interface BarClose {
  /** Whether an event's target is inside the bar. */
  inside(node: EventTarget | null): boolean
  confirmOpen(): boolean
  close(): void
}

// The object form: Node's EventTarget (the tests) matches a removal by it, not by a bare `true`
const CAPTURE = { capture: true }

export function armBarClose(target: EventTarget, a: BarClose): () => void {
  const onPointer = (e: Event): void => {
    if (a.confirmOpen() || a.inside(e.target)) return
    a.close()
  }
  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent
    if (k.key !== 'Escape' || k.isComposing || a.confirmOpen()) return
    // Taken here: an Escape that closes the bar must not also reach a terminal, where it interrupts the agent's turn
    e.preventDefault()
    e.stopPropagation()
    a.close()
  }
  target.addEventListener('pointerdown', onPointer, CAPTURE)
  target.addEventListener('keydown', onKey, CAPTURE)
  return () => {
    target.removeEventListener('pointerdown', onPointer, CAPTURE)
    target.removeEventListener('keydown', onKey, CAPTURE)
  }
}
