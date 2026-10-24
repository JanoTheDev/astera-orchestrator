// DESIGN-W13 §2, §4: the side bar. It hosts the active activity's view (sideBarViews.tsx) under a 35px view title whose
// toolbar the view fills through <ViewToolbar> (a portal into the header), and resizes on its trailing Sash.
import { useEffect, useMemo, useState } from 'react'
import {
  ACTIVITY_IDS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_VISIBLE_KEY,
  SIDEBAR_WIDTH_KEY,
  type ActivityId
} from '../../../../core/ui/pages'
import { Sash } from '../ui'
import { KeptViews } from './KeptViewHost'
import { keepViews } from './keptViews'
import { SIDE_BAR_VIEWS } from './sideBarViews'
import { storageWrite } from './shellView'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

/** What every side bar view gets: the whole app state and the shell's counts. */
export type SideBarViewProps = AppState & ShellState

export { ViewToolbar } from './KeptViewHost'

export function SideBar(p: SideBarViewProps): React.JSX.Element {
  const { activity, sidebarOpen, sidebarWidth, setSidebarWidth, t } = p
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // remembered per window (localStorage), whichever way it changed (the bar, Ctrl+B, the activity bar)
  useEffect(() => storageWrite(SIDEBAR_VISIBLE_KEY, String(sidebarOpen)), [sidebarOpen])
  const [kept, setKept] = useState<ActivityId[]>([activity])
  // derived during render so the new view is in the very render that shows it; the order is the registry's, not the
  // visit order, so React never moves a kept view's DOM (that would reset its scroll)
  const keptNow = kept[0] === activity ? kept : keepViews(kept, activity)
  if (keptNow !== kept) setKept(keptNow)
  const ids = useMemo(() => ACTIVITY_IDS.filter((id) => keptNow.includes(id)), [keptNow])
  const { title } = SIDE_BAR_VIEWS[activity]
  // collapsed: hidden, not unmounted, so reopening is instant
  return (
    <aside className="wb-sidebar" style={{ width: sidebarWidth, ...(sidebarOpen ? null : { display: 'none' }) }} aria-label={t(title)}>
      <div className="wb-sidebar__head">
        <h2 className="wb-sidebar__title">{t(title)}</h2>
        <div className="wb-sidebar__actions" ref={setSlot} />
      </div>
      <div className="wb-sidebar__body">
        <KeptViews
          ids={ids}
          active={activity}
          slot={slot}
          render={(id) => {
            const { View } = SIDE_BAR_VIEWS[id]
            return <View {...p} />
          }}
        />
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
