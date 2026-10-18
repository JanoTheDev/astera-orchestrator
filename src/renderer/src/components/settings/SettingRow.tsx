// W9-E: the wrapper every Settings row sits in. It carries the anchor openSettings(group, anchor) scrolls to, and drops
// out of a search that did not match it.
import type { SettingsDialogProps } from '../shell/SettingsDialog'

/** What every group component gets: the page's props, whether its group is on screen, and the search's hits (null = no search). */
export type GroupProps = SettingsDialogProps & { shown: boolean; only: ReadonlySet<string> | null }

export function SettingRow({
  a,
  only,
  keep = false,
  hidden = false,
  children
}: {
  a: string
  only: ReadonlySet<string> | null
  /** Stays mounted (hidden) when filtered out, for a row whose component must keep what was typed. */
  keep?: boolean
  hidden?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const out = hidden || (only !== null && !only.has(a))
  if (out && !keep) return null
  return (
    <div className="settings-anchor" id={`settings-row-${a}`} data-anchor={a} hidden={out}>
      {children}
    </div>
  )
}
