// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useState } from 'react'

export function useDialogs() {
  // W3-B: the command bar resolves names against the same data, so it is read while the bar is open too
  const [commandOpen, setCommandOpen] = useState(false)
  const [talkSignal, setTalkSignal] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  /** Whether the toolbar's configuration menu (RunConfigMenu) is open. Lifted here, not local to
   *  RunToolbar, because Task 9's run.selectConfig shortcut opens it from outside the component tree. */
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  return {
    commandOpen, setCommandOpen, talkSignal, setTalkSignal, switcherOpen, setSwitcherOpen, runMenuOpen,
    setRunMenuOpen
  }
}
