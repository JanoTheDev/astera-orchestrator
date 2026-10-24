import { Activity, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { Toolbar, type ToolbarItem } from '../ui'
import type { ActivityId } from '../../../../core/ui/pages'

export const ActionsSlot = createContext<HTMLElement | null>(null)

/** A view's title-bar actions, drawn in the host's header (DESIGN-W13 §4: the header belongs to the host). */
export function ViewToolbar({ items, label }: { items: ToolbarItem[]; label: string }): React.JSX.Element | null {
  const slot = useContext(ActionsSlot)
  return slot ? createPortal(<Toolbar items={items} label={label} />, slot) : null
}

/** Kept views stay mounted inside <Activity>; only the active one is visible and gets the header slot, so a hidden view
 *  portals no actions into the header (it would draw them over the active view's). */
export function KeptViews({ ids, active, slot, render }: {
  ids: readonly ActivityId[]
  active: ActivityId | null
  slot: HTMLElement | null
  render: (id: ActivityId) => React.ReactNode
}): React.JSX.Element {
  return (
    <>
      {ids.map((id) => (
        <Activity key={id} mode={id === active ? 'visible' : 'hidden'}>
          <ActionsSlot.Provider value={id === active ? slot : null}>{render(id)}</ActionsSlot.Provider>
        </Activity>
      ))}
    </>
  )
}
