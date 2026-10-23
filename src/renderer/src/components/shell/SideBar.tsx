// DESIGN-W13 §2, §4: the side bar. It hosts the active activity's view (sideBarViews.tsx) under a 35px view title whose
// toolbar the view fills through <ViewToolbar> (a portal into the header), and resizes on its trailing Sash.
import { createContext, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_VISIBLE_KEY, SIDEBAR_WIDTH_KEY } from '../../../../core/ui/pages'
import { Sash, Toolbar, type ToolbarItem } from '../ui'
import { SIDE_BAR_VIEWS } from './sideBarViews'
import { storageWrite } from './shellView'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

/** What every side bar view gets: the whole app state and the shell's counts. */
export type SideBarViewProps = AppState & ShellState

const ActionsSlot = createContext<HTMLElement | null>(null)

/** A view's title-bar actions, drawn in the host's header (DESIGN-W13 §4: the header belongs to the host). */
export function ViewToolbar({ items, label }: { items: ToolbarItem[]; label: string }): React.JSX.Element | null {
  const slot = useContext(ActionsSlot)
  return slot ? createPortal(<Toolbar items={items} label={label} />, slot) : null
}

export function SideBar(p: SideBarViewProps): React.JSX.Element | null {
  const { activity, sidebarOpen, sidebarWidth, setSidebarWidth, t } = p
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // remembered per window (localStorage), whichever way it changed (the bar, Ctrl+B, the activity bar)
  useEffect(() => storageWrite(SIDEBAR_VISIBLE_KEY, String(sidebarOpen)), [sidebarOpen])
  if (!sidebarOpen) return null
  const { title, View } = SIDE_BAR_VIEWS[activity]
  return (
    <aside className="wb-sidebar" style={{ width: sidebarWidth }} aria-label={t(title)}>
      <div className="wb-sidebar__head">
        <h2 className="wb-sidebar__title">{t(title)}</h2>
        <div className="wb-sidebar__actions" ref={setSlot} />
      </div>
      <div className="wb-sidebar__body">
        <ActionsSlot.Provider value={slot}>
          <View key={activity} {...p} />
        </ActionsSlot.Provider>
      </div>
      <Sash
        orientation="vertical"
        size={sidebarWidth}
        min={SIDEBAR_MIN_WIDTH}
        max={SIDEBAR_MAX_WIDTH}
        label={t('shell.sidebar.resize')}
        className="wb-sidebar__sash"
        onResize={setSidebarWidth}
        onResizeEnd={(w) => storageWrite(SIDEBAR_WIDTH_KEY, String(w))}
      />
    </aside>
  )
}
