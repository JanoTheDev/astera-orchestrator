import { Icon, Select } from './ui'
import { useI18n } from '../i18n/I18nProvider'
import { isRemoteRuntime, projectOptions, runtimeOptions } from '../lib/remoteJobs'

/** Above the Jobs view when a Runtime is paired (remote runtime design Phase 6, D1.4, D1.5): which Runtime it shows
 *  and, for a paired one, which of its projects. The remote project is its own value: it never becomes this
 *  window's project (`currentProject`). For a paired Runtime it also says the view is read only, that the Runtime is
 *  unreachable when it is, and that its Jobs' notifications follow that machine's Slack settings (Q5). */
export function RuntimeSelector({
  paired,
  runtimeId,
  onRuntime,
  projects,
  project,
  onProject,
  offline,
  readOnlyReason
}: {
  paired: Array<{ runtimeId: string; name: string }>
  runtimeId: string
  onRuntime: (runtimeId: string) => void
  projects: Array<{ id: string; name: string | null; path: string | null }> | null
  project: string | null
  onProject: (project: string) => void
  /** The unreachable line (lib/remoteJobs offlineNote), or null. */
  offline: string | null
  /** Why actions on that Runtime are off (a read-only pairing), or null when they run there (Phase 7). */
  readOnlyReason: string | null
}): React.JSX.Element {
  const { t } = useI18n()
  const remote = isRemoteRuntime(runtimeId)
  const name = paired.find((r) => r.runtimeId === runtimeId)?.name ?? runtimeId
  return (
    <div className="jobs-runtime">
      <Select items={runtimeOptions(paired, t as never)} value={runtimeId} onChange={onRuntime} ariaLabel={t('jobs.runtime.label')} />
      {remote && projects !== null && projects.length > 0 && (
        <Select
          items={projectOptions(projects, t as never)}
          value={project ?? ''}
          onChange={onProject}
          ariaLabel={t('jobs.runtime.project', { name })}
        />
      )}
      {remote && projects !== null && projects.length === 0 && (
        <p className="jobs-empty-hint runtime-note">
          <Icon name="inbox" size={14} />
          <span>{t('jobs.runtime.noProjects')}</span>
        </p>
      )}
      {remote && offline && (
        <p className="jobs-runtime-offline runtime-note" role="status">
          <Icon name="warning" size={14} />
          <span>{offline}</span>
        </p>
      )}
      {remote && (
        <p className="jobs-empty-hint runtime-note">
          <Icon name={readOnlyReason ? 'lock' : 'info'} size={14} />
          <span>{readOnlyReason ?? t('jobs.runtime.control', { name })}</span>
        </p>
      )}
      {remote && (
        <p className="jobs-empty-hint runtime-note">
          <Icon name="notifications" size={14} />
          <span>{t('jobs.runtime.slack')}</span>
        </p>
      )}
    </div>
  )
}
