// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useRef, useState } from 'react'
import { formatChord, resolveBindings, type Bindings } from '../../../core/keys/binding'
import { ACTIONS } from '../lib/actions'
import type { ActivityId } from '../../../core/ui/pages'
import { readWorkbenchLayout, storageRead } from '../components/shell/shellView'
import type { useLayout } from './useLayout'

export type SidebarDeps = Pick<ReturnType<typeof useLayout>,
    't'>

// W9-B: `t` went with the rail tooltips; the deps stay so App's call order does not change.
export function useSidebar(_deps: SidebarDeps) {
  // Keybindings. The global key handler is registered once at mount so it reads through a ref, and it
  // is also held as state so the settings screen can draw the list.
  const [keyOverrides, setKeyOverrides] = useState<Record<string, string[]>>({})
  const bindingsRef = useRef<Bindings>(resolveBindings({}, ACTIONS))
  bindingsRef.current = resolveBindings(keyOverrides, ACTIONS)
  /** The run configuration pill's shortcut, for its title — run.selectConfig opens the pill's menu, so
   *  the hint belongs there, not on the "Manage run configurations…" footer row (that opens the
   *  manager instead). Same derivation as explorerChord: read the resolved binding, not the default,
   *  so a rebind shows up here too. Undefined when the user cleared every binding for it. */
  const runSelectConfigChord = bindingsRef.current['run.selectConfig']?.[0]
  const runSelectConfigShortcut = runSelectConfigChord ? formatChord(runSelectConfigChord) : undefined
  // DESIGN-W13: the side bar's view (activity), whether it shows and its width, as last left (shell/shellView.ts).
  // activity is the one source of truth for the view; activityRef is set on every change so the keydown listener and
  // a second quick click read the view the first one left (state/sidebarView.ts).
  const [launch] = useState(() => readWorkbenchLayout(storageRead))
  const [activity, setActivity] = useState<ActivityId>(launch.activity)
  const activityRef = useRef(activity)
  activityRef.current = activity
  const [sidebarWidth, setSidebarWidth] = useState(launch.sidebarWidth)
  const [sidebarOpen, setSidebarOpen] = useState(launch.sidebarVisible)
  const [explorerOpen, setExplorerOpen] = useState(false)
  // 키 핸들러는 []로 한 번만 등록되어 첫 렌더의 클로저를 붙잡는다. toggleExplorer 가 렌더 값을 읽으면
  // 단축키가 늘 같은 방향으로만 계산되므로, 최신 값을 이 ref 로 읽는다(이 파일의 다른 ref 들과 같은 이유)
  const explorerOpenRef = useRef(explorerOpen)
  explorerOpenRef.current = explorerOpen // the file explorer toggle
  // Read by toggleSidebar, for the reason explorerOpenRef is: the keydown listener closes over the
  // first render, and whether the sidebar is on screen decides whether a press shows a view or
  // collapses it.
  const sidebarOpenRef = useRef(sidebarOpen)
  sidebarOpenRef.current = sidebarOpen
  return {
    keyOverrides, setKeyOverrides, bindingsRef, runSelectConfigShortcut,
    activity, setActivity, activityRef, sidebarWidth, setSidebarWidth,
    sidebarOpen, setSidebarOpen, explorerOpen, setExplorerOpen, explorerOpenRef, sidebarOpenRef
  }
}
