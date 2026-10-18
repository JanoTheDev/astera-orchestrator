// W9-E: Notifications (DESIGN §7) — desktop notices, sound, digest (the old notifications tab).
import { NotificationSettings } from '../NotificationSettings'
import { SettingRow, type GroupProps } from './SettingRow'

export function NotificationsSettings({ shown, only }: GroupProps): React.JSX.Element | null {
  if (!shown) return null
  return (
    <SettingRow a="notifications" only={only}>
      <NotificationSettings />
    </SettingRow>
  )
}
