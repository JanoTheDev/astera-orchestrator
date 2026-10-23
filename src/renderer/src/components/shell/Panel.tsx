// DESIGN-W13 §6: the bottom panel. Tabs Needs you (the Inbox), Activity (the coordinator's log), Output and Terminal
// (BottomPanel's run consoles and shells, mounted once for the panel's life so no xterm remounts on a tab switch).
// It shows only when the person opens it (Ctrl+J, a tab, the status bar) or starts a run (Output), never by itself.
import { PANEL_TABS, type PanelTab } from '../../../../core/ui/pages'
import type { MessageKey } from '../../../../core/i18n'
import { previewTargetOf } from '../../../../core/preview/url'
import { BottomPanel } from '../BottomPanel'
import { InboxPage } from '../inbox/InboxPage'
import { ActivityPanel } from '../activity/ActivityPanel'
import { Icon, IconButton, Sash, Tabs } from '../ui'
import { openConsole, openPanel } from './navigation'
import { shownPanelTab } from './shellView'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

const LABEL: Record<PanelTab, MessageKey> = {
  needs: 'shell.panel.needs',
  activity: 'shell.panel.activity',
  output: 'shell.panel.output',
  terminal: 'shell.panel.terminal'
}
export const PANEL_MIN_H = 100
export const PANEL_MAX_H = 800

export type PanelProps = Pick<
  AppState,
  | 'accounts' | 'actionUi' | 'bottomRoot' | 'bottomTabShown' | 'closeTerminal' | 'newTerminal' | 'openBrowserTab'
  | 'openLinkedFolder' | 'openLinkedPath' | 'openUrl' | 'panelTab' | 'runAvailable'
  | 'runConfigs' | 'runDismiss' | 'runPanelHeight' | 'runPanelOpen' | 'runStart' | 'runStop' | 'runs' | 'scopedData'
  | 'scopedTree' | 'selectedRunId' | 'setBottomTab' | 'setPanelVisible' | 'setRunPanelHeight' | 'setSelectedRunId' | 't'
  | 'terminals' | 'workspaceData' | 'workspacePlanId' | 'workspaceTree'
> &
  Pick<ShellState, 'needsYouUnread'>

export function Panel(p: PanelProps): React.JSX.Element | null {
  const { bottomTabShown, panelTab, runPanelOpen, runPanelHeight, t, terminals } = p
  const shown = shownPanelTab(panelTab, bottomTabShown)
  if (!runPanelOpen) return null
  const consoles = shown === 'output' || shown === 'terminal'
  return (
    <section className="wb-panel" style={{ height: runPanelHeight }} aria-label={t('shell.panel.label')}>
      <Sash
        orientation="horizontal"
        reverse
        size={runPanelHeight}
        min={PANEL_MIN_H}
        max={PANEL_MAX_H}
        label={t('run.resizeConsole')}
        className="wb-panel__sash"
        onResize={p.setRunPanelHeight}
        onResizeEnd={(h) => {
          try {
            localStorage.setItem('cm.runPanelHeight', String(h))
          } catch {
            // no storage: this run only
          }
        }}
      />
      <div className="wb-panel__head">
        <Tabs
          label={t('shell.panel.label')}
          value={shown}
          onChange={openPanel}
          items={PANEL_TABS.map((id) => ({ id, label: t(LABEL[id]), ...(id === 'needs' && p.needsYouUnread > 0 ? { count: p.needsYouUnread } : {}) }))}
        />
        <span className="wb-panel__spacer" />
        <IconButton size="sm" icon={<Icon name="close" />} label={t('shell.panel.close')} onClick={() => p.setPanelVisible(false)} />
      </div>
      <div className="wb-panel__body">
        {shown === 'needs' && (
          <div className="wb-panel__scroll">
            <InboxPage scope={p} ui={p.actionUi} />
          </div>
        )}
        {shown === 'activity' && (
          <div className="wb-panel__scroll">
            <ActivityPanel planId={p.workspacePlanId} accounts={p.accounts} onOpenSession={(sessionId) => openConsole(sessionId)} />
          </div>
        )}
        {/* mounted while the panel shows, hidden off its two tabs: the run consoles and shells keep their scrollback */}
        {p.bottomRoot && (
          <div className="wb-panel__consoles" style={consoles ? undefined : { display: 'none' }}>
            <BottomPanel
              runAvailable={p.runAvailable}
              runs={p.runs}
              configIds={p.runConfigs.map((c) => c.id)}
              selectedRunId={p.selectedRunId}
              onSelectRun={p.setSelectedRunId}
              onStopRun={p.runStop}
              onRerun={(configId) => p.runStart(configId)}
              onDismissRun={p.runDismiss}
              onOpenFile={p.openLinkedPath}
              onOpenFolder={p.openLinkedFolder}
              onOpenUrl={p.openUrl}
              onOpenPreview={(url) => p.openBrowserTab(previewTargetOf(url))}
              terminals={terminals}
              terminalCwd={p.bottomRoot}
              activeTab={p.bottomTabShown}
              onSelectTab={p.setBottomTab}
              onNewTerminal={() => void p.newTerminal()}
              onCloseTerminal={p.closeTerminal}
              only={shown === 'output' ? 'run' : 'terminal'}
            />
          </div>
        )}
      </div>
    </section>
  )
}
