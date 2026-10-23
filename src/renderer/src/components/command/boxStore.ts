// DESIGN-W13 §9: what the command box opens with. Ctrl+Shift+P and the title bar's command center ask for the palette
// (`>`), Ctrl+P for quick open (empty); the box takes the request when it opens. A tiny store rather than App state (like
// help/helpStore.ts), so the key handler sets it with no setter threaded through.
let pending: string | null = null

/** Asks the next opening of the box to start with `prefix`. Call it just before setCommandOpen(true). */
export function requestBox(prefix: '>' | '' | '@'): void {
  pending = prefix
}

/** The prefix asked for, once; a plain opening (the voice key) starts empty. */
export function takeBoxRequest(): string {
  const was = pending ?? ''
  pending = null
  return was
}
