// W7-A: the project's "start plans without asking" switch. Mounted by the project settings page (W7-B).
import { useState, type JSX } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'

export function AutoApproveToggle({ projectId, value, door, onError }: { projectId: string; value: boolean; door: OrchDoor; onError?(m: string): void }): JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState(value)
  const toggle = async (next: boolean): Promise<void> => {
    setOn(next) // optimistic; rolled back below
    let ok = false
    try {
      ok = (await door.command('projects-set', { id: projectId, autoApprove: next ? 'on' : 'off' })).status < 400
    } catch {
      /* ok stays false */
    }
    if (!ok) {
      setOn(!next)
      onError?.(t('plan.autoApprove.failed'))
    }
  }
  return (
    <div className="plan-autoapprove">
      <label>
        <input type="checkbox" checked={on} disabled={door.readOnlyReason != null} onChange={(e) => void toggle(e.target.checked)} />
        {t('plan.autoApprove.label')}
      </label>
      <small>{t('plan.autoApprove.hint')}</small>
    </div>
  )
}
