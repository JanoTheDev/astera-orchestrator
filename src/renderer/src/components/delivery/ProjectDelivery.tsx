// W6-H: the open project's delivery, one line above its plans: one pull request per plan (the default), a push to a
// branch with no review by a person, a merge on this computer (T6) or the owner's review. Read with `projects-find`,
// written with `projects-set` (core/orchestration/delivery.ts); a push is outward-facing, so choosing it asks first. T6:
// only what the folder is set up for is offered (useDeliveryChoices).
import { useCallback, useEffect, useState } from 'react'
import type { DeliveryMode, Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { confirmModal } from '../../lib/confirm'
import { Input, Select } from '../ui'
import { useDeliveryChoices } from './useDeliveryChoices'

/** The project's delivery, read and written: shared by the inline control below and the Plans page's View options menu. */
export function useProjectDelivery(projectPath: string): {
  project: Project | null
  mode: DeliveryMode
  /** The push target's name: the branch set, else "the default branch". */
  target: string
  error: string | null
  choose: (next: DeliveryMode) => void
  save: (args: { delivery?: DeliveryMode; deliveryBranch?: string }) => Promise<void>
} {
  const { t } = useI18n()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.orch.command(projectPath, 'projects-find', { path: projectPath })
      setProject(r.status === 200 ? (r.body as Project) : null)
    } catch {
      setProject(null)
    }
  }, [projectPath])
  useEffect(() => {
    void load()
  }, [load])

  const mode: DeliveryMode = project?.delivery ?? 'pr'
  const target = project?.deliveryBranch ?? t('delivery.defaultBranch')

  const save = async (args: { delivery?: DeliveryMode; deliveryBranch?: string }): Promise<void> => {
    if (!project) return
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
    // W12: the house confirm (was the native confirm, which halts the renderer)
    void (async () => {
      if (
        next === 'push' &&
        !(await confirmModal({
          title: t('delivery.pushConfirm.title'),
          body: t('delivery.pushConfirm', { branch: target }),
          confirmLabel: t('delivery.pushConfirm.ok', { branch: target }),
          danger: true
        }))
      )
        return
      await save({ delivery: next })
    })()
  }
  return { project, mode, target, error, choose, save }
}

export function ProjectDelivery({ projectPath, disabledReason }: { projectPath: string; disabledReason?: string }): React.JSX.Element | null {
  const { t } = useI18n()
  const { project, mode, error, choose, save } = useProjectDelivery(projectPath)
  const offered = useDeliveryChoices(projectPath, mode, project?.deliveryBranch)
  const [branch, setBranch] = useState('')
  useEffect(() => setBranch(project?.deliveryBranch ?? ''), [project])

  if (!project) return null

  return (
    <div className="jobs-delivery" title={disabledReason}>
      <label>
        {t('delivery.label')}{' '}
        <Select
          className="dense"
          ariaLabel={t('delivery.label')}
          value={offered.mode}
          disabled={disabledReason !== undefined}
          onChange={(v) => choose(v as DeliveryMode)}
          items={offered.options}
        />
      </label>
      {(offered.mode === 'push' || offered.mode === 'merge') && (
        <label>
          {t('delivery.branch')}{' '}
          <Input
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
      {offered.reason && <p className="jobs-empty-hint">{offered.reason}</p>}
      {error && <p className="jobs-empty-hint">{error}</p>}
    </div>
  )
}
