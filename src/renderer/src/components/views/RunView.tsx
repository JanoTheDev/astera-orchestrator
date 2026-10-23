// The Run side bar view (DESIGN-W13 §4). Adapter until its own Task: the run configurations (RunToolbar); output goes to
// the panel's Output tab.
import { Button, Icon, ViewContainer, ViewPane } from '../ui'
import { RunToolbar } from '../RunToolbar'
import { openPanel } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'

export function RunView(p: SideBarViewProps): React.JSX.Element {
  const { t, currentProject } = p
  return (
    <ViewContainer label={t('shell.activity.run')}>
      <ViewToolbar
        label={t('shell.activity.run')}
        items={[{ id: 'add', icon: <Icon name="add" />, label: t('shell.run.add'), disabled: !currentProject, onClick: () => p.openRunManager() }]}
      />
      <ViewPane title={t('shell.run.configs')} storageKey="run.configs">
        <div className="wb-view-pad">
          {currentProject ? (
            <RunToolbar
              configs={p.runConfigs}
              selectedId={p.runSelectedId}
              onSelect={(id) => p.applyRunSelection(currentProject, id)}
              runs={p.runs}
              onRun={() => p.runStart()}
              onRunConfig={(id) => {
                p.applyRunSelection(currentProject, id)
                p.runStart(id)
              }}
              onStop={p.runStop}
              onOpenManager={() => p.openRunManager()}
              onEditConfig={(id) => p.openRunManager(id)}
              activeRuns={p.activeRuns}
              onJump={p.runJump}
              onStopRun={p.runStop}
              menuOpen={p.runMenuOpen}
              onMenuOpenChange={p.setRunMenuOpen}
              shortcut={p.runSelectConfigShortcut}
            />
          ) : (
            <p className="wb-view-empty">{t('shell.runs.noProject')}</p>
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
    </ViewContainer>
  )
}
