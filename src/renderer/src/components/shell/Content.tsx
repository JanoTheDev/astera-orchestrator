// Moved out of App.tsx (W9-A): the JSX is App's, the values come from App's state hooks. W9-B: the consoles (the pane
// grid) stay mounted on every page and are only hidden, so no xterm remounts on a page switch (Pages.tsx); the run
// output and terminal panel is RunDrawer, below whichever page is showing.
import { BottomPanel } from '../BottomPanel'
import { setRatio } from '../../../../core/panes/tree'
import { previewTargetOf } from '../../../../core/preview/url'
import { sessionTab } from '../../../../core/panes/tabId'
import { PaneGrid } from '../PaneGrid'
import { useWallView } from '../wall/wallView'
import { Button, Icon } from '../ui'
import type { AppState } from '../../state/appState'

export type ContentProps = Pick<
  AppState,
  'accounts' | 'activePaneId' | 'agentBusy' | 'appTabInfo' |
  'browserLoading' | 'browserTabs' | 'busy' | 'canStart' | 'closeWorkbenchTab' | 'dirtyIds' |
  'dragTabId' | 'dropOnPane' | 'dropTabInGroup' | 'endTabRename' | 'fileTabs' | 'layout' | 'mediaNonces' |
  'newInGroup' | 'openLinkedFolder' | 'openLinkedPath' | 'openUrl' |
  'recordStatuses' | 'recordTabs' | 'remoteReadOnly' | 'remoteSessions' | 'remoteStatus' | 'renamingTabId' |
  'renderApp' | 'renderBrowser' | 'renderEditor' | 'renderRecord' | 'restart' | 'rollStates' |
  'runtimeName' | 'schedStates' | 'selectWorkbenchTab' | 'sessions' | 'setActivePaneId' |
  'setDragTabId' | 'setLayout' | 'setRenamingTabId' |
  'setShowNew' | 'setSwitcherOpen' | 'setTabMenu' | 'shownLayout' | 'switcherMeta' |
  'switcherOpen' | 't'
> & {
  /** Off the console pages the grid is hidden, not unmounted. */
  hidden?: boolean
}

export function Content(p: ContentProps): React.JSX.Element {
  const {
    accounts, activePaneId, agentBusy, appTabInfo, browserLoading, browserTabs,
    busy, canStart, closeWorkbenchTab, dirtyIds, dragTabId, dropOnPane, dropTabInGroup, endTabRename,
    fileTabs, layout, mediaNonces, newInGroup, openLinkedFolder, openLinkedPath,
    openUrl, recordStatuses, recordTabs, remoteReadOnly, remoteSessions, remoteStatus, renamingTabId, renderApp,
    renderBrowser, renderEditor, renderRecord, restart, rollStates,
    runtimeName, schedStates, selectWorkbenchTab,
    sessions, setActivePaneId, setDragTabId, setLayout, setRenamingTabId,
    setShowNew, setSwitcherOpen, setTabMenu, shownLayout,
    switcherMeta, switcherOpen, t, hidden
  } = p
  // Console view on the Agents page shows the opened session alone (not the whole grid); anywhere else the grid is whole.
  const wallView = useWallView()
  const soloTabId = !hidden && wallView.kind === 'console' ? sessionTab(wallView.sessionId) : undefined
  return (
    <>
        <main className={hidden ? 'content content--hidden' : 'content'}>
          {/* The container everything shares. Always mounted — .session-view must live inside it so
              opening or closing the explorer does not remount it (same rule as PaneGrid's slots).
              Named .surfaces, not .workbench: the app shell above already uses that class, and giving
              this one the same name silently overrode the shell's flex direction. */}
          <div className="surfaces">
            {/* 페인 격자. 이제 파일 탭과 세션 탭을 함께 담으므로 탐색기를 켜도 물러나지 않는다 —
                에디터는 이 안의 페인 슬롯에 있다 */}
            <div className="session-view">
              <PaneGrid
                remoteSessions={remoteSessions}
                remoteStatus={remoteStatus}
                remoteReadOnly={remoteReadOnly}
                runtimeName={runtimeName}
                renamingTabId={renamingTabId}
                onRenameStart={setRenamingTabId}
                onRenameEnd={endTabRename}
                layout={shownLayout}
                soloTabId={soloTabId}
                activePaneId={activePaneId}
                switcherOpen={switcherOpen} // W7-F (#84)
                onSwitcherClose={() => setSwitcherOpen(false)}
                switcherMeta={switcherMeta}
                sessions={sessions}
                accounts={accounts}
                fileTabs={fileTabs}
                dirtyFileIds={dirtyIds}
                recordTabs={recordTabs}
                recordStatuses={recordStatuses}
                browserTabs={browserTabs}
                browserLoading={browserLoading}
                agentBusy={agentBusy}
                renderEditor={renderEditor}
                renderRecord={renderRecord}
                renderBrowser={renderBrowser}
                appTabInfo={appTabInfo}
                renderApp={renderApp}
                rollStates={rollStates}
                schedStates={schedStates}
                busy={busy}
                draggingTabId={dragTabId}
                newDisabled={!canStart()}
                onFocusPane={setActivePaneId}
                onSetRatio={(splitId, ratio) =>
                  setLayout((cur) => (cur ? setRatio(cur, splitId, ratio) : cur))
                }
                onDropTabIntoPane={dropOnPane}
                onRestart={restart}
                onSelectTab={selectWorkbenchTab}
                onCloseTab={closeWorkbenchTab}
                onNewInGroup={newInGroup}
                onTabContextMenu={(tabId, x, y) => setTabMenu({ tabId, x, y })}
                onDragTabChange={setDragTabId}
                onDropTabInBar={dropTabInGroup}
                onOpenUrl={openUrl}
                onOpenPath={openLinkedPath}
                onOpenFolder={openLinkedFolder}
                mediaNonces={mediaNonces}
              />
              {/* When the layout is empty (not one group in the tree) there is no group tab bar, so there
                  is no '+' anywhere on screen — this placeholder becomes the sole entry point in its
                  place. Same guard as a group's '+' (newInGroup): with no CLI, pressing it does not open
                  the dialog */}
              {!layout && (
                <div className="placeholder">
                  <Button
                    variant="primary"
                    icon={<Icon name="add" />}
                    disabled={!canStart()}
                    title={canStart() ? undefined : t('cliBanner.cannotStart')}
                    onClick={() => {
                      if (canStart()) setShowNew(true)
                    }}
                  >
                    {t('session.placeholder.start')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </main>
    </>
  )
}

export type RunDrawerProps = Pick<
  AppState,
  'bottomRoot' | 'bottomTabShown' | 'closeTerminal' | 'newTerminal' | 'openBrowserTab' | 'openLinkedFolder' |
  'openLinkedPath' | 'openUrl' | 'runAvailable' | 'runConfigs' | 'runDismiss' | 'runHostRef' | 'runPanelHeight' |
  'runPanelOpen' | 'runStart' | 'runStop' | 'runs' | 'selectedRunId' | 'setBottomTab' | 'setRunPanelHeight' |
  'setRunPanelOpen' | 'setSelectedRunId' | 't' | 'terminals'
>

/** The run output and terminal panel, a drawer under every page (DESIGN.md §1): opened from Run configs or the box. */
export function RunDrawer(p: RunDrawerProps): React.JSX.Element | null {
  const {
    bottomRoot, bottomTabShown, closeTerminal, newTerminal, openBrowserTab, openLinkedFolder, openLinkedPath, openUrl,
    runAvailable, runConfigs, runDismiss, runHostRef, runPanelHeight, runPanelOpen, runStart, runStop, runs,
    selectedRunId, setBottomTab, setRunPanelHeight, setRunPanelOpen, setSelectedRunId, t, terminals
  } = p
  return (
    <>
    {/* 아래쪽 패널의 자리. 예전에는 탐색기 페인 안에 있었고 이름도 그랬지만, 이 패널은 탐색기의
        것이 아니다 — Jobs 를 보면서도 빌드를 돌려야 하고, 프로젝트가 아예 없을 때도 셸은 필요하다.
        그래서 페인을 가리지 않고, 경로는 bottomRoot(프로젝트가 없으면 홈)를 쓴다.
        (.run-host 가 flex:none 인 이유는 styles.css 에 있다) */}
    {bottomRoot && (
      <div
        className="run-host"
        ref={runHostRef}
        style={
          {
            // Run 콘솔이 이 화면 안에 있으므로 --run-panel-h 는 계속 여기에 둔다(run-resizer가
            // runHostRef로 이 값을 직접 갱신한다).
            ['--run-panel-h']: `${runPanelHeight}px`
          } as React.CSSProperties
        }
      >
        {runPanelOpen && (
          <div
            className="run-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('run.resizeConsole')}
            onPointerDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startH = runPanelHeight
              let latestY = startY
              let rafId = 0
              const clamp = (y: number): number => Math.min(800, Math.max(120, startH + (startY - y)))
              const apply = (): void => {
                rafId = 0
                runHostRef.current?.style.setProperty('--run-panel-h', `${clamp(latestY)}px`)
              }
              const onMove = (ev: PointerEvent): void => {
                latestY = ev.clientY
                if (!rafId) rafId = requestAnimationFrame(apply)
              }
              const onUp = (): void => {
                if (rafId) cancelAnimationFrame(rafId)
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
                window.removeEventListener('pointercancel', onUp)
                document.body.classList.remove('resizing-row')
                const h = clamp(latestY)
                setRunPanelHeight(h) // React state is synchronised here, once only
                localStorage.setItem('cm.runPanelHeight', String(h))
              }
              document.body.classList.add('resizing-row')
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
              window.addEventListener('pointercancel', onUp)
            }}
          />
        )}
        {runPanelOpen && (
          <BottomPanel
            runAvailable={runAvailable}
            runs={runs}
            configIds={runConfigs.map((c) => c.id)}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onStopRun={runStop}
            onRerun={(configId) => runStart(configId)}
            onDismissRun={runDismiss}
            onOpenFile={openLinkedPath}
            onOpenFolder={openLinkedFolder}
            onOpenUrl={openUrl}
            onOpenPreview={(url) => openBrowserTab(previewTargetOf(url))}
            terminals={terminals}
            terminalCwd={bottomRoot}
            activeTab={bottomTabShown}
            onSelectTab={setBottomTab}
            onNewTerminal={() => void newTerminal()}
            onCloseTerminal={closeTerminal}
            onCollapse={() => setRunPanelOpen(false)}
          />
        )}
      </div>
    )}
    </>
  )
}
