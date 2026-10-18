// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useState } from 'react'
import type { StartRequest } from '../components/pages/startLogic'

export function useDialogs() {
  // W3-B: the command bar resolves names against the same data, so it is read while the bar is open too
  const [commandOpen, setCommandOpen] = useState(false)
  const [talkSignal, setTalkSignal] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  /** Whether the toolbar's configuration menu (RunConfigMenu) is open. Lifted here, not local to
   *  RunToolbar, because Task 9's run.selectConfig shortcut opens it from outside the component tree. */
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  // W9-E: the Start page (null: not shown) and the New modal (DESIGN §2 Start, §5 New). The top bar's New calls setNewOpen.
  const [start, openStart] = useState<StartRequest | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  return {
    start, openStart, newOpen, setNewOpen,
    commandOpen, setCommandOpen, talkSignal, setTalkSignal, switcherOpen, setSwitcherOpen, runMenuOpen,
    setRunMenuOpen
  }
}
