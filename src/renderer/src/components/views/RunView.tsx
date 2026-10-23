// The Run side bar view (DESIGN-W13 §4): one pane of run configurations, each with its running state and hover Run /
// Stop / Edit. + opens the kind picker, then the edit dialog on a new draft. Output goes to the panel's Output tab.
import { useEffect, useRef, useState } from 'react'
import type { RunConfigType } from '../../../../core/run/types'
import { runTypeIcon } from '../../../../core/run/typeIcon'
import { FileIcon } from '../FileIcon'
import { RunConfigManager, detectedRunTypes } from '../RunConfigManager'
import { RunTypePicker } from '../RunTypePicker'
import { Button, Icon, IconButton, Tree, ViewContainer, ViewPane, type TreeItem } from '../ui'
import { openPanel } from '../shell/navigation'
import type { SideBarViewProps } from '../shell/SideBar'
import { runRows, runStateText } from './runRows'

type Editing = { projectPath: string; configId?: string; newType?: RunConfigType }

export function RunView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject } = p
  const [editing, setEditing] = useState<Editing | null>(null)
  const treeBox = useRef<HTMLDivElement>(null)

  // run.selectConfig (a shortcut) used to open the toolbar's menu; here it puts the keyboard on the list
  const { runMenuOpen, setRunMenuOpen } = p
  useEffect(() => {
    if (!runMenuOpen) return
    treeBox.current?.querySelector<HTMLElement>('[role="tree"]')?.focus()
    setRunMenuOpen(false)
  }, [runMenuOpen, setRunMenuOpen])

  const rows = runRows(p.runConfigs, p.runs)
  const items: TreeItem[] = rows.map((r) => ({
    id: r.config.id,
    depth: 0,
    label: r.config.name,
    icon: <FileIcon {...runTypeIcon(r.config.type)} />,
    decoration:
      r.running > 0 ? { icon: <Icon name="loading" className="run-spin" />, text: runStateText(r.running, t), tone: 'info' } : undefined,
    actions: (
      <>
        <IconButton
          size="sm"
          icon={<Icon name="run" />}
          label={t(r.running > 0 ? 'run.action.restart' : 'run.action.run')}
          onClick={() => {
            p.applyRunSelection(currentProject, r.config.id)
            p.runStart(r.config.id)
          }}
        />
        {r.stopTargets.length > 0 && <IconButton size="sm" icon={<Icon name="stop" />} label={t('run.action.stop')} onClick={() => r.stopTargets.forEach((id) => p.runStop(id))} />}
        <IconButton size="sm" icon={<Icon name="edit" />} label={t('run.view.edit')} onClick={() => currentProject && setEditing({ projectPath: currentProject, configId: r.config.id })} />
      </>
    )
  }))

  const detected = detectedRunTypes(p.runConfigs, { isPythonProject: p.runIsPythonProject, hasDockerfile: p.runHasDockerfile, composeFile: p.runContext?.composeFile })

  return (
    <ViewContainer label={t('shell.activity.run')}>
      <ViewPane
        title={t('shell.run.configs')}
        count={currentProject ? p.runConfigs.length : undefined}
        storageKey="run.configs"
        actions={currentProject ? <RunTypePicker detected={detected} onPick={(newType) => setEditing({ projectPath: currentProject, newType })} /> : undefined}
      >
        <div className="run-view" ref={treeBox}>
          {!currentProject ? (
            <p className="wb-view-empty">{t('shell.runs.noProject')}</p>
          ) : items.length === 0 ? (
            <p className="wb-view-empty">{t('run.view.empty')}</p>
          ) : (
            <Tree
              label={t('run.view.tree')}
              rows={items}
              selectedId={p.runSelectedId}
              onSelect={(id) => p.applyRunSelection(currentProject, id)}
              onOpen={(id) => setEditing({ projectPath: currentProject, configId: id })}
            />
          )}
          <div className="wb-view-actions">
            <Button size="sm" onClick={() => openPanel('output')}>
              {t('shell.runs.output')}
            </Button>
            <Button size="sm" onClick={() => openPanel('terminal')}>
              {t('shell.runs.terminal')}
            </Button>
          </div>
        </div>
      </ViewPane>
      {editing && p.runContext && (
        <RunConfigManager
          configs={p.runConfigs}
          context={p.runContext}
          isSpringBoot={p.runIsSpringBoot}
          isPythonProject={p.runIsPythonProject}
          hasDockerfile={p.runHasDockerfile}
          projectPath={editing.projectPath}
          initialSelectedId={editing.configId}
          initialNewType={editing.newType}
          onApply={(configs) => p.runManagerApply(editing.projectPath, configs)}
          onClose={() => setEditing(null)}
        />
      )}
    </ViewContainer>
  )
}
