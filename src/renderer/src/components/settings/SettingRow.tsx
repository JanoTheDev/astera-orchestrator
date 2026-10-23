// W9-E: the wrapper every Settings row sits in. It carries the anchor openSettings(group, anchor) scrolls to, and drops
// out of a search that did not match it.
import { createContext, useContext } from 'react'
import type { SettingsDialogProps } from '../shell/SettingsDialog'
import { nextFocusIndex } from '../ui'
import { rowVisible } from './settingsIndex'

/** Arrow keys (and Home/End) move focus among the `selector` controls inside the element that has this handler: the
 *  side nav's groups, and the theme and resume-strategy card choices. Tab still visits each in order. */
export function arrowFocus(selector: string, orientation: 'horizontal' | 'vertical' = 'vertical') {
  return (e: React.KeyboardEvent<HTMLElement>): void => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector))
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    // a grid wraps, so both arrow pairs move: Left/Up back, Right/Down on
    const key = orientation === 'horizontal' ? ({ ArrowUp: 'ArrowLeft', ArrowDown: 'ArrowRight' } as Record<string, string>)[e.key] ?? e.key : e.key
    const next = nextFocusIndex(at, items.length, key, orientation)
    if (next === null) return
    e.preventDefault()
    items[next].focus()
  }
}

/** Whether the advanced rows of the group being drawn show (T19). The page sets it per group; a bare row shows. */
export const ShowAdvancedContext = createContext(true)

/** What every group component gets: the page's props, whether its group is on screen, and the search's hits (null = no search). */
export type GroupProps = SettingsDialogProps & { shown: boolean; only: ReadonlySet<string> | null }

export function SettingRow({
  a,
  only,
  keep = false,
  hidden = false,
  modified = false,
  children
}: {
  a: string
  only: ReadonlySet<string> | null
  /** Stays mounted (hidden) when filtered out, for a row whose component must keep what was typed. */
  keep?: boolean
  hidden?: boolean
  /** The value differs from its default: a 2px accent marker on the row's left. */
  modified?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const showAdvanced = useContext(ShowAdvancedContext)
  const out = hidden || !rowVisible(a, showAdvanced, only)
  if (out && !keep) return null
  return (
    <div className={modified ? 'settings-anchor settings-anchor--modified' : 'settings-anchor'} id={`settings-row-${a}`} data-anchor={a} hidden={out}>
      {children}
    </div>
  )
}
