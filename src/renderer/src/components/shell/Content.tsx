// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { BottomPanel } from '../BottomPanel'
import { WorkspaceHeader } from '../workspace/WorkspaceHeader'
import { setRatio } from '../../../../core/panes/tree'
import { previewTargetOf } from '../../../../core/preview/url'
import { PaneGrid } from '../PaneGrid'
import type { AppState } from '../../state/appState'

export type ContentProps = Pick<
  AppState,
  'accounts' | 'active' | 'activePaneId' | 'agentBusy' | 'appTabInfo' | 'bottomRoot' | 'bottomTabShown' |
  'browserLoading' | 'browserTabs' | 'busy' | 'canStart' | 'closeTerminal' | 'closeWorkbenchTab' | 'dirtyIds' |
  'dragTabId' | 'dropOnPane' | 'dropTabInGroup' | 'endTabRename' | 'fileTabs' | 'layout' | 'mediaNonces' |
  'newInGroup' | 'newTerminal' | 'openBrowserTab' | 'openLinkedFolder' | 'openLinkedPath' | 'openUrl' |
  'recordStatuses' | 'recordTabs' | 'remoteReadOnly' | 'remoteSessions' | 'remoteStatus' | 'renamingTabId' |
  'renderApp' | 'renderBrowser' | 'renderEditor' | 'renderRecord' | 'restart' | 'rollStates' | 'runAvailable' |
  'runConfigs' | 'runDismiss' | 'runHostRef' | 'runPanelHeight' | 'runPanelOpen' | 'runStart' | 'runStop' | 'runs' |
  'runtimeName' | 'schedStates' | 'selectWorkbenchTab' | 'selectedRunId' | 'sessions' | 'setActivePaneId' |
  'setBottomTab' | 'setDragTabId' | 'setLayout' | 'setRenamingTabId' | 'setRunPanelHeight' | 'setRunPanelOpen' |
  'setSelectedRunId' | 'setShowNew' | 'setSwitcherOpen' | 'setTabMenu' | 'shownLayout' | 'switcherMeta' |
  'switcherOpen' | 't' | 'terminals' | 'workspaceActive'
>

export function Content(p: ContentProps): React.JSX.Element {
  const {
    accounts, active, activePaneId, agentBusy, appTabInfo, bottomRoot, bottomTabShown, browserLoading, browserTabs,
    busy, canStart, closeTerminal, closeWorkbenchTab, dirtyIds, dragTabId, dropOnPane, dropTabInGroup, endTabRename,
    fileTabs, layout, mediaNonces, newInGroup, newTerminal, openBrowserTab, openLinkedFolder, openLinkedPath,
    openUrl, recordStatuses, recordTabs, remoteReadOnly, remoteSessions, remoteStatus, renamingTabId, renderApp,
    renderBrowser, renderEditor, renderRecord, restart, rollStates, runAvailable, runConfigs, runDismiss, runHostRef,
    runPanelHeight, runPanelOpen, runStart, runStop, runs, runtimeName, schedStates, selectWorkbenchTab,
    selectedRunId, sessions, setActivePaneId, setBottomTab, setDragTabId, setLayout, setRenamingTabId,
    setRunPanelHeight, setRunPanelOpen, setSelectedRunId, setShowNew, setSwitcherOpen, setTabMenu, shownLayout,
    switcherMeta, switcherOpen, t, terminals, workspaceActive
  } = p
  return (
    <>
        <main className="content">
          {/* The container everything shares. Always mounted — .session-view must live inside it so
              opening or closing the explorer does not remount it (same rule as PaneGrid's slots).
              Named .surfaces, not .workbench: the app shell above already uses that class, and giving
              this one the same name silently overrode the shell's flex direction. */}
          <div className="surfaces">
            {/* 페인 격자. 이제 파일 탭과 세션 탭을 함께 담으므로 탐색기를 켜도 물러나지 않는다 —
                에디터는 이 안의 페인 슬롯에 있다 */}
            {workspaceActive && (
              <WorkspaceHeader session={workspaceActive} info={active ?? undefined} accounts={accounts} />
            )}
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
                <button
                  className="placeholder primary"
                  disabled={!canStart()}
                  onClick={() => {
                    if (canStart()) setShowNew(true)
                  }}
                >
                  {t('session.placeholder.start')}
                </button>
              )}
            </div>
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
          </div>
        </main>
    </>
  )
}
