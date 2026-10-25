// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect } from 'react'
import { pollWhileVisible } from '../lib/visiblePoll'
import type { RunConfig, RunStatus, SaveConfigsResult } from '../../../core/types'
import { pickRunSelection, pickRunToShow } from '../../../core/run/selection'
import { toolbarState, upsertRun } from '../../../core/run/instances'
import { foldPathCase } from '../../../core/files/paths'
import { toast } from '../lib/toast'
import { sessionTab } from '../../../core/panes/tabId'
import { sameOrNext } from '../lib/remoteSessions'
import type { useWorkbench } from './useWorkbench'
import type { useLayout } from './useLayout'
import type { useRunPanel } from './useRunPanel'
import type { useWorkspace } from './useWorkspace'
import type { useJobs } from './useJobs'
import type { useWorkbenchState } from './useWorkbenchState'

export type RunActionsDeps = Pick<ReturnType<typeof useWorkbench>,
    'active' | 'bottomRootRef' | 'currentProjectRef' | 'setBottomTab' | 'setTerminals' | 'terminals'> &
  Pick<ReturnType<typeof useLayout>,
    'activeSessionId' | 'remoteSessions' | 'sessionsRef' | 't'> &
  Pick<ReturnType<typeof useRunPanel>,
    'applyRunSelection' | 'runConfigs' | 'runContext' | 'runHasDockerfile' | 'runIsPythonProject' |
    'runIsSpringBoot' | 'runSelectedByProject' | 'runSelectedId' | 'runs' | 'selectedRunId' | 'setManagerFor' |
    'setManagerInitialSelectedId' | 'setRunConfigs' | 'setRunContext' | 'setRunPanelOpen' | 'setRuns' |
    'setSelectedRunId'> &
  Pick<ReturnType<typeof useWorkspace>,
    'bottomRoot' | 'openWorkspaceProject' | 'workspaceTree'> &
  Pick<ReturnType<typeof useJobs>,
    'currentProject'> &
  Pick<ReturnType<typeof useWorkbenchState>,
    'fileTabsRef' | 'runRerunSelectedRef' | 'runStartRef' | 'runStopSelectionRef' | 'selectWorkbenchTabRef' |
    'setUsage'>

export function useRunActions(deps: RunActionsDeps) {
  const {
    active, activeSessionId, applyRunSelection, bottomRoot, bottomRootRef, currentProject, currentProjectRef,
    fileTabsRef, remoteSessions, runConfigs, runContext, runHasDockerfile, runIsPythonProject, runIsSpringBoot,
    runRerunSelectedRef, runSelectedByProject, runSelectedId, runStartRef, runStopSelectionRef, runs,
    selectWorkbenchTabRef, selectedRunId, sessionsRef, setBottomTab, setManagerFor, setManagerInitialSelectedId,
    setRunConfigs, setRunContext, setRunPanelOpen, setRuns, setSelectedRunId, setTerminals, setUsage,
    t, terminals, openWorkspaceProject, workspaceTree
  } = deps

  /** What a freshly started run does to the screen: merged into the list, selected, its project's
   *  terminal tabs refreshed, and the panel opened. Shared by ▶ (runStart) and the explorer's "Run
   *  'x'" (runFile) — from the moment main hands back a RunStatus, the two paths are identical. Callers
   *  check currentProjectRef against `root` before calling this (the project may have changed while
   *  the IPC was in flight); merging first would inject another project's run into this list — and
   *  nothing would ever evict it: upsertRun evicts only on a seat match within the same project, and
   *  the run:status subscription filters foreign events. The row would sit there frozen at 'running',
   *  with its ⏹ and ✕ acting on another project's process. */
  const showStartedRun = async (root: string, st: RunStatus): Promise<void> => {
    setRuns((prev) => upsertRun(prev, st))
    setSelectedRunId(st.runId)
    // Starting a Run may be what opens the panel for the first time — and that also mounts this
    // project's existing terminal tabs (in a hidden state). TerminalBody replays initialBuffer only
    // once, at mount, and ignores later updates, so the latest buffer has to be read *before* the
    // setRunPanelOpen(true) that causes the mount — the same reason as in openTerminal.
    if (terminals.length > 0) {
      const list = await window.api.terminal.list(root).catch(() => terminals)
      // The same check again after the await — the project can change during this call too. Without
      // discarding, the screen shows the new project while the panel holds the previous project's
      // terminal tabs, and input goes to that shell.
      if (currentProjectRef.current !== root) return
      setTerminals(list)
    }
    setRunPanelOpen(true)
  }
  /** ▶, and the list's ↻. `configId` defaults to the toolbar's selection; the list passes its row's. Main
   *  decides whether this starts a new run or restarts a live one (decideStart) and returns the run either
   *  way — that run is merged into the list and selected, so the console follows what was just started. */
  const runStart = (configId: string | null = runSelectedId): void => {
    if (!currentProject || !configId) return
    const root = currentProject
    void window.api.run.start(root, configId).then(
      async (st) => {
        if (currentProjectRef.current !== root) return
        await showStartedRun(root, st)
      },
      (err) => toast.error(t('run.start.failed', { detail: err instanceof Error ? err.message : String(err) }))
    )
  }
  /** The explorer's "Run 'x'" item. Main creates or reuses the configuration and starts it; from here
   *  on it is a started run like any other, so it goes through the same path ▶ does. */
  const runFile = (filePath: string): void => {
    if (!currentProject) return
    const root = currentProject
    void window.api.run.runFile(root, filePath).then(
      async ({ run, configId }) => {
        if (currentProjectRef.current !== root) return
        await showStartedRun(root, run)
        // Main may have created a configuration for this file, or evicted the oldest temporary one to
        // make room. Neither reaches the renderer any other way — run.list is refetched on load, on a
        // root seed-file change and on the manager's Apply, and none of those fires here. Without this
        // the new configuration is missing from the pill's menu and the console's ↻ reports it as
        // deleted.
        const r = await window.api.run.list(root)
        if (currentProjectRef.current !== root) return
        setRunConfigs(r.configs)
        // The same rule the menu's inline ▶ follows: the pill must name what is running. `configId`
        // rather than the started run's, because a configuration with a before-launch task starts its
        // task first — the pill would otherwise name the prerequisite and stay there, and the next ▶
        // would restart that instead of the file.
        applyRunSelection(root, configId)
      },
      (err) => toast.error(t('run.start.failed', { detail: err instanceof Error ? err.message : String(err) }))
    )
  }
  const runStop = (runId: string): void => {
    void window.api.run.stop(runId)
  }
  // The run shortcuts' refs (see their declaration above): kept fresh on every render so the keydown
  // effect's stale closure still calls today's runStart/runStop against today's runs and selection.
  runStartRef.current = () => runStart()
  // The same expansion the toolbar's ⏹ makes (toolbarState.stopTargets), so a compound stops every live member.
  runStopSelectionRef.current = () => toolbarState(runs, runSelectedId, runConfigs).stopTargets.forEach(runStop)
  // What the run list's ↻ does: restart the selected run's own configuration. Silently does nothing
  // with the panel closed or no run selected, like the other run shortcuts' no-ops.
  runRerunSelectedRef.current = (): void => {
    if (!selectedRunId) return
    const configId = runs.find((r) => r.runId === selectedRunId)?.configId
    // The rail's ↻ is disabled when the configuration is gone (rerunGone); a run outlives its
    // configuration when the manager deletes it or the temporary cap evicts it. The shortcut has to
    // carry the same guard, or it sends a dead id and the user reads a raw NO_CONFIG.
    if (!configId || !runConfigs.some((c) => c.id === configId)) return
    runStart(configId)
  }
  /** The list's ✕ on a finished run. main drops it (its exitCode and output with it — otherwise a run.list
   *  re-read brings the row back) and the local list follows without waiting. Selection moves to the
   *  nearest remaining row. With no runs and no terminals left the panel collapses: a panel with nothing
   *  but ＋ in it is worse than a collapsed one. */
  const runDismiss = (runId: string): void => {
    void window.api.run.dismiss(runId)
    const remaining = runs.filter((r) => r.runId !== runId)
    setRuns(remaining)
    if (selectedRunId === runId) setSelectedRunId(pickRunToShow(remaining))
    if (remaining.length === 0 && terminals.length === 0) setRunPanelOpen(false)
  }
  /** Opens the two-pane manager, snapshotting the current project the way managerFor's own comment
   *  explains. Shared by the toolbar's ⋮ item and the configuration menu's "Edit '<name>'…" row — the
   *  only difference between them is which configuration the dialog opens on. */
  const openRunManager = (initialSelectedId?: string): void => {
    if (!currentProject || !runContext) return
    setManagerFor({
      projectPath: currentProject,
      configs: runConfigs,
      context: runContext,
      isSpringBoot: runIsSpringBoot,
      isPythonProject: runIsPythonProject,
      hasDockerfile: runHasDockerfile
    })
    setManagerInitialSelectedId(initialSelectedId)
  }
  /** RunConfigManager's Apply. On success the toolbar's list is refetched the same way the old
   *  per-item save did — promoting a seed *removes* an id (mergeConfigs stops emitting seed:npm:dev the
   *  moment a stored config shares its seedKeyOf), so the selection has to be reconciled or ▶ keeps a
   *  seed id that no longer resolves. On refusal nothing was stored; the dialog shows the reasons. A
   *  throw (the save itself failing, not a refused item) becomes a toast and an empty-error refusal.
   *
   *  Takes the project explicitly instead of reading currentProject — the dialog is pinned to the
   *  project it opened with (see managerFor), and that can differ from whatever the toolbar shows by
   *  the time Apply fires. */
  const runManagerApply = async (projectPath: string, configs: RunConfig[]): Promise<SaveConfigsResult> => {
    try {
      const result = await window.api.run.saveConfigs(projectPath, configs)
      // The toolbar only follows when it is still showing the project that was applied — the dialog is
      // pinned to the project it opened with, so those two can differ.
      if (result.ok && currentProjectRef.current === projectPath) {
        const r = await window.api.run.list(projectPath)
        setRunConfigs(r.configs)
        setRunContext(r.context)
        applyRunSelection(projectPath, pickRunSelection(r.configs, runSelectedByProject.current[projectPath]))
      }
      return result
    } catch (err) {
      // A refused *item* comes back as ok:false with reasons the dialog paints; a throw is the save
      // itself failing (the disk, a permission) and has no item to name — so it takes the toast the
      // single-item save used to, and the dialog keeps the draft with nothing marked.
      toast.error(t('run.config.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
      return { ok: false, errors: [] }
    }
  }
  /** 실행 중 목록에서 다른 프로젝트로 점프. 트리 루트는 활성 탭이 정하므로, 그 프로젝트에 속한 탭을
   *  활성으로 만드는 것이 곧 '그리로 간다'는 뜻이다. 세션을 먼저 찾고 없으면 그 프로젝트의 파일 탭을
   *  쓴다.
   *
   *  (T12: the fallback below now selects the project in the title bar; the sticky root it describes is gone.)
   *
   *  **둘 다 없으면 sticky 루트를 그 프로젝트로 옮긴다.** 이 폴백은 탭이 하나도 없는 상태에서만
   *  무언가를 한다 — runSlot 이 explorerRoot 에서 currentProject 로 옮겨 오면서 처음 생긴 상태이고,
   *  그 상태에서는 이 툴바가 그려지는데도(전역 실행 목록이 거기 있다) 활성화할 탭이 없어 점프 버튼이
   *  조용히 아무 일도 하지 않았다.
   *
   *  이것이 없앤 '탐색기에서 열기' 버튼들의 모순을 되살리지 않는 이유: 그 버튼들은 **탭이 있는
   *  상태에서** 루트를 핀으로 바꾸려 했고, activeTabRoot 가 언제나 stickyRoot 를 이기므로
   *  (currentProject 참고) 화면이 움직이지 않아 무력했다. 여기서는 탭이 있으면 위의 두 분기가 먼저
   *  탭 활성화로 끝나므로 이 줄에 도달하지 않는다 — 즉 이기지 못하는 자리에서 이기려 하지 않는다.
   *  경로는 run.listActive 가 준 것이라 main 의 가드가 이미 허용한 값이다. */
  const runJump = (projectPath: string): void => {
    const norm = (p: string): string => foldPathCase(p.replace(/\\/g, '/').replace(/\/+$/, ''), window.api.platform)
    const target = norm(projectPath)
    const session = sessionsRef.current.find((s) => norm(s.cwd) === target)
    if (session) {
      selectWorkbenchTabRef.current(sessionTab(session.id))
      return
    }
    const file = fileTabsRef.current.find((t) => norm(t.projectRoot) === target)
    if (file) {
      selectWorkbenchTabRef.current(file.id)
      return
    }
    // T12: no tab of it is open: the title bar moves to that project, and every view with it. A folder no project
    // holds cannot be the window's project.
    const project = workspaceTree.find((p) => norm(p.path) === target)
    if (project) openWorkspaceProject(project.id)
    else toast.error(t('run.jump.notAllowed'))
  }

  // openTerminal calls newTerminal below, so it is declared first to match reading order — an arrow
  // function is not hoisted, but this is only definition order rather than execution, so no order can
  // produce a runtime reference error (both are created when the component body runs, and the actual
  // call happens later on a click, by which time openTerminal's closure over newTerminal is initialised).
  /** `command`: typed into the new shell and run (Devices' Run in a terminal). `cwd`: where the shell starts
   *  (the explorer's Open in Terminal); default is the bottom root. main lists a terminal under the folder it was
   *  opened in, so a re-list for another root does not return it. */
  const newTerminal = async (command?: string, cwd?: string): Promise<void> => {
    // bottomRoot — openTerminal 과 같은 경로여야 한다. currentProject 로 두면 프로젝트가 없을 때
    // 여기서 조용히 빠지고, 패널만 열린 채 터미널이 만들어지지 않는다.
    if (!bottomRoot) return
    try {
      const info = await window.api.terminal.open(cwd ?? bottomRoot)
      if (command) window.api.terminal.write(info.id, `${command}\r`)
      setTerminals((prev) => [...prev, { id: info.id, buffer: '' }])
      setBottomTab(info.id)
      setRunPanelOpen(true)
    } catch (err) {
      toast.error(
        t('terminal.open.failed', { detail: err instanceof Error ? err.message : String(err) })
      )
    }
  }

  // The rail terminal button: opens the panel, creates a terminal if this project has none, and otherwise just focuses
  const openTerminal = async (): Promise<void> => {
    // bottomRoot — 프로젝트가 없으면 홈에서 연다
    if (!bottomRoot) return
    const root = bottomRoot
    if (terminals.length > 0) {
      // Collapsing unmounts BottomPanel and every TerminalBody inside it (the runPanelOpen gate).
      // TerminalBody replays initialBuffer only once, at mount, and ignores later updates, so the latest
      // buffer has to be read *before* the setRunPanelOpen(true) that causes the remount — updating
      // terminals after the mount does not reach an xterm that is already mounted.
      const list = await window.api.terminal.list(root).catch(() => terminals)
      // If the root changes while this is in flight, the result is discarded — the list effect has
      // already set the new root's list, so overwriting with the old result would leave the screen on
      // the new root while the active tab is the previous one's terminal, sending input to that shell.
      // bottomRootRef, not currentProjectRef: with no project those two differ (null vs the home
      // directory), so comparing against the project ref bailed on every call.
      if (bottomRootRef.current !== root) return
      setTerminals(list)
      if (list.length === 0) {
        // If a missed terminal:exit means the re-query really does come back empty, create one instead
        // of merely opening the Run tab — that is what this rail terminal button is for
        setRunPanelOpen(true)
        await newTerminal()
        return
      }
      setBottomTab(list[0].id)
      setRunPanelOpen(true)
      return
    }
    setRunPanelOpen(true)
    await newTerminal()
  }

  const closeTerminal = (id: string): void => {
    void window.api.terminal.close(id).catch(() => {})
    setTerminals((prev) => prev.filter((x) => x.id !== id))
    setBottomTab((cur) => (cur === id ? 'run' : cur))
  }

  // Usage for the active session (context, 5-hour, weekly). One question for both providers — main
  // picks the source (claude: statusLine capture file, codex: rollout tail). Either way it is a value
  // that only changes when a turn completes, so it is re-queried periodically (cheap, no CLI or
  // network involved) and immediately on a session switch.
  // (Separate from the activeSessionId state — only an id whose session existence was confirmed by
  // active is used.)
  const usageSessionId = active?.id
  const activeRemote = activeSessionId ? remoteSessions.find((r) => r.key === activeSessionId) ?? null : null
  const activeRemoteKey = activeRemote?.key ?? null
  useEffect(() => {
    if (!usageSessionId) {
      setUsage(null)
      return
    }
    let cancelled = false
    const load = (): void => {
      void window.api.usage
        .session(usageSessionId)
        .then((u) => {
          // The same figures keep the held state (performance audit R2): a new object every 3 s re-rendered the app.
          if (!cancelled) setUsage((held) => sameOrNext(held, u))
        })
        .catch(() => {})
    }
    // Nothing asked while the window is hidden; asked again as it shows (pollWhileVisible).
    const stop = pollWhileVisible(load, 3_000)
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      stop()
      window.removeEventListener('focus', onFocus)
    }
  }, [usageSessionId])

  // Main needs the session on screen to suppress a notification for it, and the renderer is the only
  // place that can answer — panes and tabs are its structure (design doc §7). null covers a file tab
  // being focused, no pane having a session, and the panes being empty.
  useEffect(() => {
    window.api.notify.activeSession({ sessionId: activeRemoteKey ?? usageSessionId ?? null })
  }, [usageSessionId, activeRemoteKey])
  return {
    runStart, runFile, runStop, runDismiss, openRunManager, runManagerApply, runJump, newTerminal, openTerminal,
    closeTerminal, activeRemote
  }
}
