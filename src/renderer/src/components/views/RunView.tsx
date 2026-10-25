// The Run side bar view (DESIGN-W13 §4): the project's run configurations, one row each — type icon, name, a running
// state, and hover Run / Stop / Edit. Output goes to the panel's Output tab (runStart opens it). The run shortcuts
// (run.run / run.stop / run.rerun) act on the selected row; run.selectConfig focuses this list.
import { useEffect, useRef, useState } from 'react'
import type { RunConfig } from '../../../../core/types'
import type { RunConfigType } from '../../../../core/run/types'
import { duplicateItem, isSeedId, removeItem } from '../../../../core/run/draft'
import { exitWording } from '../../../../core/sessions/exitWording'
import { runTypeIcon } from '../../../../core/run/typeIcon'
import { FileIcon } from '../FileIcon'
import { RunConfigManager } from '../RunConfigManager'
import { RunTypePicker } from '../RunTypePicker'
import { confirmModal } from '../../lib/confirm'
import { Icon, IconButton, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type MenuItem, type TreeItem } from '../ui'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { configActionsOf, type ConfigAction } from '../runConfigActions'
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
  const [ctx, setCtx] = useState<{ id: string; at: { x: number; y: number } } | null>(null)

  // run.selectConfig (revealRunConfigs) shows this view and raises the flag; it lands the keyboard on the list
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

  /** Duplicate and Delete save the whole list the way the manager's Apply does (runManagerApply refetches it). */
  const saveConfigs = (configs: RunConfig[]): void => {
    if (!currentProject) return
    void p.runManagerApply(currentProject, configs)
  }
  const showOutput = (runId: string): void => {
    p.setSelectedRunId(runId)
    p.setRunPanelOpen(true)
  }

  const act = async (c: RunConfig, action: ConfigAction): Promise<void> => {
    const row = runRowState(runs, runConfigs, c.id)
    switch (action) {
      case 'run':
      case 'restart':
        return run(c.id)
      case 'stop':
        return row.state === 'running' ? row.stopTargets.forEach((id) => p.runStop(id)) : undefined
      case 'edit':
        return open({ configId: c.id })
      case 'duplicate':
        return saveConfigs(duplicateItem({ items: runConfigs }, c.id, `user:${crypto.randomUUID()}`).items)
      case 'delete': {
        const ok = await confirmModal({
          title: t('shell.run.deleteTitle'),
          body: t('shell.run.deleteBody', { name: c.name }),
          confirmLabel: t('shell.run.delete'),
          danger: true
        })
        return ok ? saveConfigs(removeItem({ items: runConfigs }, c.id).items) : undefined
      }
      case 'output':
        return row.state === 'idle' ? undefined : showOutput(row.outputRunId)
      case 'dismiss':
        return row.state === 'exited' ? row.dismissTargets.forEach((id) => p.runDismiss(id)) : undefined
    }
  }
  const ACTION_LABEL: Record<ConfigAction, Parameters<typeof t>[0]> = {
    run: 'run.action.run',
    restart: 'run.action.restart',
    stop: 'run.action.stop',
    edit: 'run.row.edit',
    duplicate: 'run.manager.duplicate',
    delete: 'shell.run.delete',
    output: 'shell.run.showOutput',
    dismiss: 'shell.run.dismiss'
  }
  const menuOf = (c: RunConfig): MenuItem[] =>
    configActionsOf(runRowState(runs, runConfigs, c.id), { seed: isSeedId(c.id) }).map((a) => ({
      id: a.id,
      label: t(ACTION_LABEL[a.id]),
      danger: a.danger,
      disabled: a.disabled,
      onSelect: () => void act(c, a.id)
    }))

  const rowOf = (c: RunConfig): TreeItem => {
    const row = runRowState(runs, runConfigs, c.id)
    const live = row.state === 'running' || row.state === 'stopping'
    const exit = row.state === 'exited' ? exitWording(row.run.exitCode, { closedByAstera: row.run.closedByAstera, closeReason: row.run.closeReason }) : null
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
        : exit && row.state === 'exited'
          ? { icon: <Icon name={row.failed ? 'error' : 'check'} size={14} />, text: t(exit.key, exit.params), tone: row.failed ? 'danger' : 'neutral' }
          : undefined,
      actions: (
        <>
          {row.state === 'exited' ? (
            <>
              <IconButton size="sm" label={t('shell.run.showOutput')} icon={<Icon name="terminal" size={14} />} onClick={() => showOutput(row.outputRunId)} />
              <IconButton size="sm" label={t('shell.run.dismiss')} icon={<Icon name="close" size={14} />} onClick={() => row.dismissTargets.forEach((id) => p.runDismiss(id))} />
            </>
          ) : null}
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
              onContextMenu={(id, e) => {
                e.preventDefault()
                setCtx({ id, at: menuPointOf(e) })
              }}
            />
          </div>
        )}
      </ViewPane>
      {ctx && runConfigs.some((c) => c.id === ctx.id) && (
        <Menu label={t('shell.run.configs')} at={ctx.at} items={menuOf(runConfigs.find((c) => c.id === ctx.id)!)} onClose={() => setCtx(null)} />
      )}
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
