// W9-E: Projects (DESIGN §7) — the orchestration projects, each with W7-B's page inline, and Add project.
// W12: the project is picked with the ui Select (was a hand-made listbox of buttons); one EmptyState when there is none.
import { useState } from 'react'
import { Button, EmptyState, Icon, ICONS, Select } from '../ui'
import { ProjectSettingsBody } from '../projects/ProjectSettings'
import { OTHER_WORKSPACE } from '../../state/workspaceTree'
import { SettingRow, type GroupProps } from './SettingRow'

export function ProjectsSettings({ shown, only, accounts, projectAnchor, setProjectDialog, workspaceTree, t }: GroupProps): React.JSX.Element | null {
  const [picked, setPicked] = useState<string | null>(null)
  if (!shown) return null
  const projects = workspaceTree.filter((pr) => pr.id !== OTHER_WORKSPACE)
  const selected = projects.find((pr) => pr.id === picked) ?? projects[0]
  // The add/new dialogs and the project's own reads go through the anchor, as from the project switcher.
  const tools = projectAnchor ? undefined : t('settings.projects.noAnchor')
  const add = (
    <Button
      variant={projects.length === 0 ? 'primary' : 'secondary'}
      size="sm"
      icon={<Icon name="folderAdd" size={14} />}
      disabled={!projectAnchor}
      title={tools}
      onClick={() => setProjectDialog('add')}
    >
      {t('settings.projects.add')}
    </Button>
  )
  return (
    <SettingRow a="projects" only={only}>
      <div className="settings-projects-head">
        <span className="settings-hint">{t('settings.projects.hint')}</span>
        {projects.length > 0 && add}
        <Button size="sm" variant="ghost" icon={<Icon name="add" size={14} />} disabled={!projectAnchor} title={tools} onClick={() => setProjectDialog('new')}>
          {t('settings.projects.new')}
        </Button>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={ICONS.repo} title={t('settings.projects.empty')} action={add}>
          {t('settings.projects.emptyHint')}
        </EmptyState>
      ) : (
        <div className="proj-pick-body">
          <div className="proj-pick">
            <Select
              ariaLabel={t('settings.projects.list')}
              value={selected?.id ?? ''}
              onChange={setPicked}
              items={projects.map((pr) => ({ value: pr.id, label: pr.name, meta: pr.path, icon: <Icon name="repo" size={14} /> }))}
            />
          </div>
          {selected && projectAnchor && (
            // keyed: another project starts from its own reads, not the previous one's half-typed fields
            <ProjectSettingsBody key={selected.id} anchor={projectAnchor} projectId={selected.id} accounts={accounts} />
          )}
        </div>
      )}
    </SettingRow>
  )
}
