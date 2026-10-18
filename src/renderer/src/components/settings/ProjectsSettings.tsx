// W9-E: Projects (DESIGN §7) — the orchestration projects, each with W7-B's page inline, and Add project.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, EmptyState } from '../ui'
import { ProjectSettingsBody } from '../projects/ProjectSettings'
import { OTHER_WORKSPACE } from '../workspace/workspaceTree'
import { SettingRow, type GroupProps } from './SettingRow'

export function ProjectsSettings({ shown, only, accounts, projectAnchor, setProjectDialog, workspaceTree, t }: GroupProps): React.JSX.Element | null {
  const [picked, setPicked] = useState<string | null>(null)
  if (!shown) return null
  const projects = workspaceTree.filter((pr) => pr.id !== OTHER_WORKSPACE)
  const selected = projects.find((pr) => pr.id === picked) ?? projects[0]
  // The add/new dialogs and the project's own reads go through the anchor, as from the project switcher.
  const tools = projectAnchor ? undefined : t('settings.projects.noAnchor')
  return (
    <SettingRow a="projects" only={only}>
      <div className="settings-projects-head">
        <span className="settings-hint">{t('settings.projects.hint')}</span>
        <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={!projectAnchor} title={tools} onClick={() => setProjectDialog('add')}>
          {t('settings.projects.add')}
        </Button>
        <Button size="sm" disabled={!projectAnchor} title={tools} onClick={() => setProjectDialog('new')}>
          {t('settings.projects.new')}
        </Button>
      </div>
      {projects.length === 0 ? (
        <EmptyState>{t('settings.projects.empty')}</EmptyState>
      ) : (
        <div className="settings-projects">
          <div className="settings-projects-list" role="listbox" aria-label={t('settings.projects.list')}>
            {projects.map((pr) => (
              <button
                key={pr.id}
                type="button"
                role="option"
                aria-selected={pr.id === selected?.id}
                className={`settings-nav-item ${pr.id === selected?.id ? 'active' : ''}`}
                title={pr.path}
                onClick={() => setPicked(pr.id)}
              >
                {pr.name}
              </button>
            ))}
          </div>
          <div className="settings-projects-body">
            {selected && projectAnchor && (
              // keyed: another project starts from its own reads, not the previous one's half-typed fields
              <ProjectSettingsBody key={selected.id} anchor={projectAnchor} projectId={selected.id} accounts={accounts} />
            )}
          </div>
        </div>
      )}
    </SettingRow>
  )
}
