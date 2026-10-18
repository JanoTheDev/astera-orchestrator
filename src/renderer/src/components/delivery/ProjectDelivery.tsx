// W6-H: the open project's delivery, one line above its plans: one pull request per plan (the default), or a push to a
// branch with no review by a person. Read with `projects-find`, written with `projects-set` (core/orchestration/
// delivery.ts); a push is outward-facing, so choosing it asks first.
import { useCallback, useEffect, useState } from 'react'
import type { DeliveryMode, Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'

export function ProjectDelivery({ projectPath, disabledReason }: { projectPath: string; disabledReason?: string }): React.JSX.Element | null {
  const { t } = useI18n()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [branch, setBranch] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.orch.command(projectPath, 'projects-find', { path: projectPath })
      const p = r.status === 200 ? (r.body as Project) : null
      setProject(p)
      setBranch(p?.deliveryBranch ?? '')
    } catch {
      setProject(null)
    }
  }, [projectPath])
  useEffect(() => {
    void load()
  }, [load])

  if (!project) return null
  const mode: DeliveryMode = project.delivery ?? 'pr'
  const target = project.deliveryBranch ?? t('delivery.defaultBranch')

  const save = async (args: { delivery?: DeliveryMode; deliveryBranch?: string }): Promise<void> => {
    setError(null)
    try {
      const r = await window.api.orch.command(projectPath, 'projects-set', { id: project.id, ...args })
      if (r.status >= 400) setError((r.body as { error?: string } | null)?.error ?? t('delivery.saveFailed'))
    } catch {
      setError(t('delivery.saveFailed'))
    }
    await load()
  }
  const choose = (next: DeliveryMode): void => {
    if (next === mode) return
    if (next === 'push' && !window.confirm(t('delivery.pushConfirm', { branch: target }))) return
    void save({ delivery: next })
  }

  return (
    <div className="jobs-delivery" title={disabledReason}>
      <label>
        {t('delivery.label')}{' '}
        <select value={mode} disabled={disabledReason !== undefined} onChange={(e) => choose(e.target.value as DeliveryMode)}>
          <option value="pr">{t('delivery.pr')}</option>
          <option value="push">{t('delivery.push', { branch: target })}</option>
        </select>
      </label>
      {mode === 'push' && (
        <label>
          {t('delivery.branch')}{' '}
          <input
            value={branch}
            placeholder={t('delivery.defaultBranch')}
            disabled={disabledReason !== undefined}
            onChange={(e) => setBranch(e.target.value)}
            onBlur={() => {
              if (branch.trim() !== (project.deliveryBranch ?? '')) void save({ deliveryBranch: branch.trim() })
            }}
          />
        </label>
      )}
      {error && <p className="jobs-empty-hint">{error}</p>}
    </div>
  )
}
