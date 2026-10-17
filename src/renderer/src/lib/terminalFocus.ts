// W4: a terminal takes the keyboard when its tab opens or comes forward, but never from a field the person is typing in
// elsewhere (the command bar, a dialog, a form). Found on Linux in W4: a worker tab that opened or came forward while the
// command bar was open took the keyboard, and the rest of the typed command went into that session as a prompt.

/** What this reads of `document.activeElement`; a plain shape so it is testable without a DOM. */
export interface FocusedElement {
  tagName: string
  isContentEditable?: boolean
  closest(selector: string): unknown
}

/** Whether a terminal may take focus away from `active` (null: nothing has it). */
export function terminalMayTakeFocus(active: FocusedElement | null): boolean {
  if (!active) return true
  // Another terminal's input (xterm's helper textarea): moving between session tabs
  if (active.closest('.xterm')) return true
  if (active.closest('[role="dialog"]')) return false
  const tag = active.tagName.toUpperCase()
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable === true)
}
