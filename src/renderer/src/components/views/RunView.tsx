// The Run side bar view (DESIGN-W13 §4): the project's run configurations, one row each — type icon, name, a running
// state, and hover Run / Stop / Edit. Output goes to the panel's Output tab (runStart opens it). The run shortcuts
// (run.run / run.stop / run.rerun) act on the selected row; run.selectConfig focuses this list.
import { useEffect, useRef, useState } from 'react'
import type { RunConfig } from '../../../../core/types'
import type { RunConfigType } from '../../../../core/run/types'
import { isSeedId } from '../../../../core/run/draft'
import { runTypeIcon } from '../../../../core/run/typeIcon'
import { FileIcon } from '../FileIcon'
import { RunConfigManager } from '../RunConfigManager'
import { RunTypePicker } from '../RunTypePicker'
import { Icon, IconButton, Tree, ViewContainer, ViewPane, type TreeItem } from '../ui'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { runRowState, runRowText } from './runRows'

/** What the editor modal was opened for: one configuration, or a new one of a kind. */
type Editing = { configId?: string; newType?: RunConfigType }

export function RunView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject, runConfigs, runs, runContext } = p
  const [editing, setEditing] = useState<Editing | null>(null)
  // The dialog renders from the snapshot it was opened with, not the live list: an edit in progress must not be clobbered
  // (the same rule as RunConfigManager's own `configs`).
  const [snapshot, setSnapshot] = useState<{
    projectPath: string
    configs: RunConfig[]
  } | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  // run.selectConfig used to open the top bar's menu; here it lands the keyboard on the list
  const { runMenuOpen, setRunMenuOpen } = p
  useEffect(() => {
    if (!runMenuOpen) return
    setRunMenuOpen(false)
    treeRef.current?.querySelector<HTMLElement>('[role="tree"]')?.focus()
  }, [runMenuOpen, setRunMenuOpen])

  const open = (next: Editing): void => {
    if (!currentProject || !runContext) return
    setSnapshot({ projectPath: currentProject, configs: runConfigs })
    setEditing(next)
  }
  const close = (): void => {
    setEditing(null)
    setSnapshot(null)
  }

  const run = (id: string): void => {
    if (!currentProject) return
    p.applyRunSelection(currentProject, id)
    p.runStart(id)
  }

  const rowOf = (c: RunConfig): TreeItem => {
    const row = runRowState(runs, runConfigs, c.id)
    const live = row.state !== 'idle'
    return {
      id: c.id,
      depth: 0,
      label: c.name,
      title: isSeedId(c.id) ? c.name : undefined,
      icon: <FileIcon {...runTypeIcon(c.type)} />,
      decoration: live
        ? {
            icon: row.state === 'running' ? <Icon name="loading" size={14} className="run-row-spin" /> : undefined,
            text: runRowText(row, t),
            tone: 'ok'
          }
        : undefined,
      actions: (
        <>
          {row.state === 'running' ? (
            <IconButton
              size="sm"
              label={t('run.action.stop')}
              icon={<Icon name="stop" size={14} />}
              onClick={() => row.stopTargets.forEach((id) => p.runStop(id))}
            />
          ) : null}
          <IconButton
            size="sm"
            label={t(live ? 'run.action.restart' : 'run.action.run')}
            icon={<Icon name={live ? 'rerun' : 'run'} size={14} />}
            disabled={row.state === 'stopping'}
            onClick={() => run(c.id)}
          />
          <IconButton size="sm" label={t('run.row.edit')} icon={<Icon name="edit" size={14} />} onClick={() => open({ configId: c.id })} />
        </>
      )
    }
  }

  const detected: RunConfigType[] = Array.from(
    new Set([
      ...runConfigs.filter((c) => isSeedId(c.id)).map((c) => c.type),
      ...(p.runIsPythonProject ? (['python', 'pytest'] as const) : []),
      ...(runContext?.composeFile ? (['compose'] as const) : []),
      ...(p.runHasDockerfile ? (['dockerfile'] as const) : [])
    ])
  )

  const title = t('shell.activity.run')
  return (
    <ViewContainer label={title}>
      <ViewToolbar
        label={title}
        items={[
          {
            id: 'refresh',
            icon: <Icon name="refresh" />,
            label: t('run.view.refresh'),
            disabled: !currentProject,
            onClick: () => {
              if (!currentProject) return
              void window.api.run.list(currentProject).then((r) => {
                p.setRunConfigs(r.configs)
                p.setRunContext(r.context)
              })
            }
          }
        ]}
      />
      <ViewPane
        title={t('shell.run.configs')}
        count={currentProject ? runConfigs.length : undefined}
        storageKey="run.configs"
        actions={currentProject && runContext ? <RunTypePicker detected={detected} onPick={(type) => open({ newType: type })} /> : undefined}
      >
        {!currentProject ? (
          <p className="wb-view-empty">{t('shell.runs.noProject')}</p>
        ) : runConfigs.length === 0 ? (
          <p className="wb-view-empty">{t('run.view.empty')}</p>
        ) : (
          <div className="run-tree" ref={treeRef}>
            <Tree
              label={t('shell.run.configs')}
              rows={runConfigs.map(rowOf)}
              selectedId={p.runSelectedId}
              onSelect={(id) => currentProject && p.applyRunSelection(currentProject, id)}
              onOpen={run}
            />
          </div>
        )}
      </ViewPane>
      {editing && snapshot && runContext && (
        <RunConfigManager
          configs={snapshot.configs}
          context={runContext}
          isSpringBoot={p.runIsSpringBoot}
          isPythonProject={p.runIsPythonProject}
          hasDockerfile={p.runHasDockerfile}
          projectPath={snapshot.projectPath}
          initialSelectedId={editing.configId}
          initialNewType={editing.newType}
          onApply={(configs) => p.runManagerApply(snapshot.projectPath, configs)}
          onClose={close}
        />
      )}
    </ViewContainer>
  )
}
