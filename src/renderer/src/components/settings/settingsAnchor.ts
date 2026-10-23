// The group an openSettings anchor reveals for this visit: an advanced row's group, so the row shows without turning
// Advanced mode on. A basic row, or an anchor no row carries, reveals nothing.
import { SETTINGS_ROWS, type SettingsGroupId } from './settingsIndex'

export function anchorRevealGroup(anchor: string): SettingsGroupId | null {
  const row = SETTINGS_ROWS.find((r) => r.anchor === anchor)
  return row?.level === 'advanced' ? row.group : null
}
