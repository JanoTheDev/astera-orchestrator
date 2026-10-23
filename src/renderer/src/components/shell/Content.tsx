// Moved out of App.tsx (W9-A): the JSX is App's, the values come from App's state hooks. DESIGN-W13: the editor area,
// always the pane grid, mounted for the window's life so no xterm remounts when the side bar switches views. Its tabs
// include the `view` tabs (viewTabs.tsx); an empty layout shows Welcome.
import { setRatio } from '../../../../core/panes/tree'
import { viewTab } from '../../../../core/panes/tabId'
import { AgentsPage } from '../pages/AgentsPage'
import { PaneGrid } from '../PaneGrid'
import { Welcome } from './Welcome'
import { renderViewTab, viewTabInfo, type ViewTabProps } from './viewTabs'

export type ContentProps = ViewTabProps

export function Content(p: ContentProps): React.JSX.Element {
  const {
    accounts, activePaneId, agentBusy, appTabInfo, browserLoading, browserTabs,
    busy, canStart, closeWorkbenchTab, dirtyIds, dragTabId, dropOnPane, dropTabInGroup, endTabRename,
    fileTabs, layout, mediaNonces, newInGroup, openLinkedFolder, openLinkedPath,
    openUrl, recordStatuses, recordTabs, remoteReadOnly, remoteSessions, remoteStatus, renamingTabId, renderApp,
    renderBrowser, renderEditor, renderRecord, restart, rollStates,
    runtimeName, schedStates, selectWorkbenchTab,
    sessions, setActivePaneId, setDragTabId, setLayout, setRenamingTabId,
    setSwitcherOpen, setTabMenu, shownLayout,
    switcherMeta, switcherOpen
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
                renderView={(name, arg, active) => renderViewTab(p, name, arg, active)}
                viewTabInfo={(name, arg) => viewTabInfo(p, name, arg)}
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
              {/* an empty layout has no group and so no tab bar: Welcome is the way in (New plan, Open a console) */}
              {!layout && <Welcome {...p} />}
            </div>
          </div>
        </main>
    </>
  )
}

/** The editor area: the Agents page around the pane grid, both mounted for the window's life. The Agents page owns the
 *  console data and the owner hold; the grid gets the whole area. */
export function EditorArea(p: ContentProps): React.JSX.Element {
  return (
    <div className="wb-editor">
      <AgentsPage {...p}>
        <Content {...p} />
      </AgentsPage>
    </div>
  )
}
