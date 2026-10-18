// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useRef, useState } from 'react'
import { formatChord, resolveBindings, type Bindings } from '../../../core/keys/binding'
import { ACTIONS } from '../lib/actions'
import type { useLayout } from './useLayout'

export type SidebarDeps = Pick<ReturnType<typeof useLayout>,
    't'>

export function useSidebar(deps: SidebarDeps) {
  const {
    t
  } = deps
  // Keybindings. The global key handler is registered once at mount so it reads through a ref, and it
  // is also held as state so the settings screen can draw the list.
  const [keyOverrides, setKeyOverrides] = useState<Record<string, string[]>>({})
  const bindingsRef = useRef<Bindings>(resolveBindings({}, ACTIONS))
  bindingsRef.current = resolveBindings(keyOverrides, ACTIONS)
  /** 레일의 탐색기 버튼 툴팁. 사용자가 키를 바꿨으면 바꾼 키가 나와야 하므로 기본값이 아니라 해석된
   *  바인딩에서 읽는다. 그 액션의 키를 모두 지운 사용자에게는 이름만 남는다 */
  const explorerChord = bindingsRef.current['explorer.toggleMode']?.[0]
  const explorerShortcutLabel = explorerChord
    ? `${t('explorer.rail.toggle')} (${formatChord(explorerChord)})`
    : t('explorer.rail.toggle')
  /** 레일의 홈 버튼 툴팁. 탐색기와 같은 이유·같은 방식이다 — 이 화면으로 돌아오는 길이 버튼
   *  하나뿐이었으므로, 키가 있다는 사실도 그 버튼에서 알게 한다. */
  const homeChord = bindingsRef.current['sidebar.home']?.[0]
  const homeShortcutLabel = homeChord
    ? `${t('session.rail.openSessions')} (${formatChord(homeChord)})`
    : t('session.rail.openSessions')
  /** The run configuration pill's shortcut, for its title — run.selectConfig opens the pill's menu, so
   *  the hint belongs there, not on the "Manage run configurations…" footer row (that opens the
   *  manager instead). Same derivation as explorerChord: read the resolved binding, not the default,
   *  so a rebind shows up here too. Undefined when the user cleared every binding for it. */
  const runSelectConfigChord = bindingsRef.current['run.selectConfig']?.[0]
  const runSelectConfigShortcut = runSelectConfigChord ? formatChord(runSelectConfigChord) : undefined
  const [sidebarOpen, setSidebarOpen] = useState(true)
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
    keyOverrides, setKeyOverrides, bindingsRef, explorerShortcutLabel, homeShortcutLabel, runSelectConfigShortcut,
    sidebarOpen, setSidebarOpen, explorerOpen, setExplorerOpen, explorerOpenRef, sidebarOpenRef
  }
}
