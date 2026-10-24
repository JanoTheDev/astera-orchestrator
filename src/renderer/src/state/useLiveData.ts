// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useLayoutEffect } from 'react'
import { mirrorsFromList } from '../lib/workspaceMirror'
import { mirrorFrames, takeWorkspaceEvent } from '../lib/mirrorFrames'
import { jobsStallRecheckInMs } from '../../../core/orchestration/jobsView'
import { LOCAL, isRemoteRuntime, remotePollReady } from '../lib/remoteJobs'
import { startSerialPoll } from '../lib/serialPoll'
import { pickRunSelection, pickRunToShow } from '../../../core/run/selection'
import { upsertRun } from '../../../core/run/instances'
import { foldPathCase, parentDir } from '../../../core/files/paths'
import { dismiss, toast } from '../lib/toast'
import { sameOrNext } from '../lib/remoteSessions'
import { displayHostOf, previewTargetOf } from '../../../core/preview/url'
import { onFileChanges } from '../lib/fileChanges'
import { needsUnderstanding } from '../lib/understandingRead'
import { liveCache, orchSnapshotFor, readThrough, startOrchFeed, useOrchConsumed } from './orchFeed'
import type { useLayout } from './useLayout'
import type { useRunPanel } from './useRunPanel'
import type { useWorkspace } from './useWorkspace'
import type { useWorkbench } from './useWorkbench'
import type { useViews } from './useViews'
import type { useJobs } from './useJobs'
import type { useWorkbenchState } from './useWorkbenchState'
import type { useSidebar } from './useSidebar'
import type { usePlanPages } from '../components/pages/PlansPage' // W9-C
/** How often a paired Runtime's Jobs are asked again while its view is open: it pushes nothing to this app yet. */
const REMOTE_JOBS_POLL_MS = 5_000
/** Where a Runtime that has not yet answered starts: its Jobs in folders that are no project (review I3). */
const UNREGISTERED_PROJECT = { id: 'unregistered', name: null, path: null }

export type LiveDataDeps = Pick<ReturnType<typeof useLayout>,
    'activeTab' | 't'> &
  Pick<ReturnType<typeof useRunPanel>,
    'applyRunSelection' | 'previewOfferedRef' | 'runConfigsRef' | 'runSelectedByProject' | 'runs' | 'selectedRunId' |
    'setActiveRuns' | 'setRunConfigs' | 'setRunContext' | 'setRunHasDockerfile' | 'setRunIsPythonProject' |
    'setRunIsSpringBoot' | 'setRunPanelOpen' | 'setRuns' | 'setSelectedRunId'> &
  Pick<ReturnType<typeof useWorkspace>,
    'bottomRoot'> &
  Pick<ReturnType<typeof useWorkbench>,
    'closeAgentTabRef' | 'currentProjectRef' | 'pairedRuntimes' | 'setBottomTab' | 'setPairedRuntimes' |
    'setTerminals'> &
  Pick<ReturnType<typeof useViews>,
    'completeOpenTask' | 'openAgentTabRef' | 'openBrowserTabRef' | 'openUrlRef' | 'takeMirrors'> &
  Pick<ReturnType<typeof useJobs>,
    'currentProject' | 'hostDriver' | 'jobsRuntime' | 'jobsRuntimeRef' | 'pairedChanged' | 'parkedSinceMs' |
    'remoteProject' | 'remoteProjectFor' | 'remoteRefresh' | 'replyGate' | 'setHostDriver' | 'setJobsRuntime' |
    'setOpenRun' | 'setOrchHostGate' | 'setOrchSnapshot' | 'setParkedSinceMs' | 'setRemoteProject' |
    'setRemoteProjectFor' | 'setRemoteProjects' | 'setRemoteSnapshot' | 'setStallTick'> &
  Pick<ReturnType<typeof useWorkbenchState>,
    'hiwOpen' | 'jobsOpen' | 'jobsOpenRef' | 'mirrorsRef' | 'recordTabs' | 'sessionTasksSeq' | 'setAgentBusy' |
    'setAgentPointer' | 'setOpenTasks' | 'setSessionTasksSeq' | 'setUnderstanding' | 'setUnderstandingSeq' |
    'understandingSeq'> &
  Pick<ReturnType<typeof useSidebar>,
    'sidebarOpen' | 'sidebarOpenRef'> &
  // W9-C: the Tasks and Plans pages read the same snapshot
  Pick<ReturnType<typeof usePlanPages>, 'planPage'>

export function useLiveData(deps: LiveDataDeps) {
  const { planPage } = deps
  const {
    activeTab, applyRunSelection, bottomRoot, closeAgentTabRef, completeOpenTask, currentProject, currentProjectRef,
    hiwOpen, hostDriver, jobsOpen, jobsOpenRef, jobsRuntime, jobsRuntimeRef, mirrorsRef, openAgentTabRef,
    openBrowserTabRef, openUrlRef, pairedChanged, pairedRuntimes, parkedSinceMs, previewOfferedRef, recordTabs,
    remoteProject, remoteProjectFor, remoteRefresh, replyGate, runConfigsRef, runSelectedByProject, runs,
    selectedRunId, sessionTasksSeq, setActiveRuns, setAgentBusy, setAgentPointer, setBottomTab, setHostDriver,
    setJobsRuntime, setOpenRun, setOpenTasks, setOrchHostGate, setOrchSnapshot, setPairedRuntimes, setParkedSinceMs,
    setRemoteProject, setRemoteProjectFor, setRemoteProjects, setRemoteSnapshot, setRunConfigs, setRunContext,
    setRunHasDockerfile, setRunIsPythonProject, setRunIsSpringBoot, setRunPanelOpen, setRuns, setSelectedRunId,
    setSessionTasksSeq, setStallTick, setTerminals, setUnderstanding, setUnderstandingSeq, sidebarOpen,
    sidebarOpenRef, t, takeMirrors, understandingSeq
  } = deps

  // Loads that project's run configurations and active run whenever the host pane or the root changes
  useEffect(() => {
    // 여기는 currentProject 그대로다 — 실행 구성은 프로젝트 단위이므로 홈에서는 읽을 것이 없다.
    if (!currentProject) return
    const project = currentProject
    // 거부를 삼키지 않고 상태를 비운다. 이 호출은 예전에 탐색기가 열려 있을 때만 돌았고 지금은
    // 프로젝트가 있으면 항상 돈다 — 그래서 가드가 거부하는 루트(사라진 워크트리의 파일 탭 등)가
    // 처리되지 않은 거부로 콘솔에 튀어나왔다. 실패하면 이전 프로젝트의 구성이 남는 것이 더 나쁘므로
    // 비운다: 남겨 두면 그 목록의 ▶ 가 다른 프로젝트를 실행한다.
    // The project's last answer shows at once and the read refreshes it; a failure clears this project's entry only.
    return readThrough(liveCache, `run:${project}`, () => window.api.run.list(project), (r, fresh) => {
      if (r === null) {
        setRunConfigs([])
        setRuns([])
        setSelectedRunId(null)
        applyRunSelection(project, null)
        setRunContext(null)
        return
      }
      setRunConfigs(r.configs)
      setRuns(r.runs)
      // Follow a live run if there is one, else the first row, else nothing
      setSelectedRunId(pickRunToShow(r.runs))
      setRunIsSpringBoot(r.isSpringBoot)
      setRunIsPythonProject(r.isPythonProject)
      setRunHasDockerfile(r.hasDockerfile)
      setRunContext(r.context)
      // 프로젝트가 바뀌는 유일한 자리다. 직전 선택이 아니라 **이 프로젝트에 기억된** 선택을
      // 물어본다 — 씨앗 id 는 프로젝트를 담지 않아서, 직전 선택을 들고 오면 이름이 같은
      // 스크립트가 있는 프로젝트마다 그 선택이 따라다닌다(runSelectedByProject 주석).
      applyRunSelection(
        project,
        pickRunSelection(
          r.configs,
          runSelectedByProject.current[project],
          r.runs.find((x) => x.status !== 'exited')?.configId
        )
      )
      // Only a fresh answer opens the panel: the cached one may still list a run that has since exited.
      if (fresh && r.runs.some((x) => x.status === 'running')) setRunPanelOpen(true)
    })
  }, [currentProject])

  // Loads that project's How It Works understanding whenever the project changes — same shape as
  // run.list just above. **This must sit here, after currentProject is declared** — its dependency
  // array is evaluated during render, and placing it up near hiwOpen (where the brief for this task
  // first sketched it) would read currentProject before that `const` runs and crash with a TDZ
  // ReferenceError (this file has hit that exact mistake before; see the newRunOpen and openRun
  // effects above). A project that has never been analyzed resolves to null — UnderstandingView's
  // empty state draws that, the same as no project at all.
  //
  // **거부 갈래도 run.list 와 같은 모양이다.** understanding.get 은 assertAllowedPath 를 부르고 그것은
  // 던지므로(ipc.ts), 허용 목록에서 밀려난 루트(사라진 워크트리 등)는 처리되지 않은 거부로 콘솔에
  // 튀어나온다. 그리고 실패했을 때 이전 프로젝트의 이해가 남는 것이 더 나쁘다 — 그 목록에서 줄을
  // 누르면 새 프로젝트 이름 아래에서 이전 프로젝트의 기능이 열린다. 두 갈래 모두 루트를 함께 실어
  // 그 값이 어느 프로젝트의 것인지를 캐시가 스스로 말하게 한다.
  // Read while it is shown (audit UI-12); a change pushed meanwhile is read when it is next shown.
  const wantUnderstanding = needsUnderstanding({ hiwOpen, activeKind: activeTab?.kind, recordTabs: recordTabs.length })
  useEffect(() => {
    if (!currentProject) return setUnderstanding(null)
    if (!wantUnderstanding) return
    const root = currentProject
    // Cached per project like run.list, so History opens with the last read while it is read again.
    return readThrough(liveCache, `understanding:${root}`, () => window.api.understanding.get(root), (u) =>
      setUnderstanding({ root, data: u })
    )
  }, [currentProject, understandingSeq, wantUnderstanding])

  // The open-task section's own load — same shape as the understanding effect just above, including
  // the root travelling with the data and the two failure/success branches resolving to the same
  // project key. **Unlike `understanding.get`, main does not fold this path** — workUnits.json is
  // keyed by the raw session cwd, a different key space from understanding.json's origin-repo fold
  // (ipc.ts's sessionTasks.* handlers explain why) — so this passes `currentProject` straight
  // through, same as main does on its end.
  useEffect(() => {
    if (!currentProject) return setOpenTasks(null)
    const root = currentProject
    let alive = true
    void window.api.sessionTasks.list(root).then(
      (tasks) => {
        if (alive) setOpenTasks({ root, data: tasks })
      },
      () => {
        if (alive) setOpenTasks({ root, data: [] })
      }
    )
    return () => {
      alive = false
    }
  }, [currentProject, sessionTasksSeq])

  // The Host gate, read once and then listened for. **Its own effect with no dependencies**, because
  // it is one fact about the app rather than about a project (ruling F41): tying it to jobsOpen or to
  // currentProject is what hid it, and the read is what covers a window that mounts after main had
  // already given up on the Host. It costs one IPC call per window.
  useEffect(() => {
    let cancelled = false
    void window.api.orch
      .hostGate()
      .then((gate) => {
        if (!cancelled) setOrchHostGate(gate)
      })
      .catch(() => {})
    const off = window.api.on('orch:host', (gate) => {
      if (!cancelled) setOrchHostGate(gate)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // S6-11: time a parked Host with no gate read yet, and draw again when it has lasted long enough to name.
  const parkedUnread = hostDriver?.driver === 'parked' && hostDriver.gate === null
  useEffect(() => {
    setParkedSinceMs(parkedUnread ? Date.now() : null)
  }, [parkedUnread])
  useEffect(() => {
    const wait = jobsStallRecheckInMs({ driver: hostDriver, parkedSinceMs, nowMs: Date.now() })
    if (wait === null) return
    // A little past the threshold, so a timer that fires a millisecond early still finds it crossed.
    const timer = setTimeout(() => setStallTick((n) => n + 1), wait + 50)
    return () => clearTimeout(timer)
  }, [hostDriver, parkedSinceMs])

  // Who drives Jobs (limits L3): read once, then listened for, the same shape and the same reason as
  // the gate above.
  useEffect(() => {
    let cancelled = false
    void window.api.host
      .driver()
      .then((r) => {
        if (!cancelled) setHostDriver(r)
      })
      .catch(() => {})
    const off = window.api.on('host:driver', (r) => {
      if (!cancelled) setHostDriver(r)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Loads the orchestration snapshot and subscribes to further changes. orch.list doubles as the subscription (OrchApi's
  // doc comment): its return value is the initial payload and must be rendered, because 'orch:state' only carries
  // changes after it. orch.unwatch on stop is the way out, the same pair as files.watch/unwatch and git.watch/unwatch.
  //
  // A project switch shows that project's last snapshot from the cache before the paint (layout effect), never the
  // previous project's: null when it was never read ("not known yet", which the views draw nothing for), an empty
  // snapshot with no project (no answer is coming, so the empty state). Leaving a view keeps the snapshot, so coming
  // back draws it at once while the re-armed watch reads it again.
  useLayoutEffect(() => {
    setOrchSnapshot(orchSnapshotFor(liveCache, currentProject))
  }, [currentProject])
  // The watch stays armed while anything draws the snapshot: the Plans view (a collapsed sidebar hides every view), a
  // plan page, or a view counted by useOrchConsumer (the Main plan tab). With none, unwatch: main otherwise folds and
  // pushes for nobody. Its folds are coalesced per tick and versioned (main/orchPush.ts), so watching while a consumer
  // is mounted, not only while the Plans view shows, costs the CLI nothing.
  const orchTabConsumed = useOrchConsumed()
  const orchConsumed = (jobsOpen && sidebarOpen) || !!planPage || orchTabConsumed
  useEffect(() => {
    if (!orchConsumed || !currentProject) return
    return startOrchFeed({
      project: currentProject,
      cache: liveCache,
      list: (project) => window.api.orch.list(project),
      onState: (cb) => window.api.on('orch:state', cb),
      unwatch: () => void window.api.orch.unwatch(),
      show: setOrchSnapshot
    })
  }, [orchConsumed, currentProject])

  // **The paired Runtimes, read each time the Jobs view opens** (Phase 6): Settings may have paired or removed one.
  useEffect(() => {
    if (!jobsOpen || !sidebarOpen) return
    void window.api.remote.list().then(setPairedRuntimes, () => setPairedRuntimes([]))
  }, [jobsOpen, sidebarOpen, pairedChanged])
  // A Runtime removed in Settings falls back to this computer.
  useEffect(() => {
    if (isRemoteRuntime(jobsRuntime) && !pairedRuntimes.some((r) => r.runtimeId === jobsRuntime)) setJobsRuntime(LOCAL)
  }, [pairedRuntimes, jobsRuntime])
  // The selected Runtime's projects; its first one is shown until the person picks another. A remote detail open
  // from the Runtime before closes: it was that Runtime's.
  useEffect(() => {
    setRemoteProjects(null)
    setRemoteProject(null)
    setRemoteProjectFor(null)
    setRemoteSnapshot(null)
    setOpenRun((o) => (o?.runtimeId ? null : o))
    if (!isRemoteRuntime(jobsRuntime)) return
    let alive = true
    let stop: () => void = () => {}
    // An unreachable Runtime has no answer, not an empty list (review I3): until it answers, the view asks for its
    // unregistered Jobs, which main answers with the last list it had, marked offline, and asks again later.
    stop = startSerialPoll(async () => {
      const list = await window.api.remote.projects(jobsRuntime).catch(() => null)
      if (!alive) return
      if (list === null) {
        setRemoteProjects((p) => p ?? [UNREGISTERED_PROJECT])
        setRemoteProject((p) => p ?? UNREGISTERED_PROJECT.id)
        setRemoteProjectFor(jobsRuntime)
        return
      }
      stop()
      setRemoteProjects(list)
      setRemoteProject((p) => (p !== null && list.some((x) => x.id === p) ? p : (list[0]?.id ?? null)))
      setRemoteProjectFor(jobsRuntime)
    }, REMOTE_JOBS_POLL_MS, {
      // Not asked while nobody sees it (performance audit, small): a hidden window, or the Jobs view closed
      paused: () => document.hidden || !jobsOpenRef.current || !sidebarOpenRef.current
    })
    return () => {
      alive = false
      stop()
    }
  }, [jobsRuntime])
  // Another project's Jobs are not this one's: nothing of the last one is drawn while the new one is asked.
  useEffect(() => {
    setRemoteSnapshot(null)
  }, [remoteProject])
  // **The remote list**: asked now and every few seconds, since a Runtime pushes nothing to this app yet, and drawn
  // only through the reply gate. An unreachable Runtime answers with its last list marked offline (main keeps it).
  useEffect(() => {
    if (!remotePollReady({ open: jobsOpen && sidebarOpen, runtimeId: jobsRuntime, project: remoteProject, projectFor: remoteProjectFor })) return
    const project = remoteProject as string
    let alive = true
    // One request at a time (review C1): a Runtime slower than the interval still has its offline answer drawn.
    // Nothing is asked while the window is hidden; the first turn after it shows asks again.
    const stop = startSerialPoll(
      async () => {
        const token = replyGate.begin('jobs', jobsRuntime)
        const snapshot = await window.api.orch.list(project, jobsRuntime)
        // An unchanged answer keeps the object App holds (second pass R2-4), so nothing below draws again for it.
        if (alive && replyGate.accept('jobs', jobsRuntime, token, jobsRuntimeRef.current)) setRemoteSnapshot((prev) => sameOrNext(prev, snapshot))
        // The paired list too: a Runtime's reach and last answer for the choice, and one removed elsewhere.
        const paired = await window.api.remote.list().catch(() => null)
        if (alive && paired) setPairedRuntimes((prev) => sameOrNext(prev, paired))
      },
      REMOTE_JOBS_POLL_MS,
      { paused: () => document.hidden }
    )
    return () => {
      alive = false
      stop()
    }
  }, [jobsOpen, sidebarOpen, jobsRuntime, remoteProject, remoteProjectFor, replyGate, remoteRefresh])

  // 배경 재생성이 끝나면 main 이 밀어 준다 — 그 결과가 화면에 닿는 유일한 길이다. 재생성은
  // 작업 단위가 닫힐 때 저절로 돌고 수십 초가 걸리므로, 이것이 없으면 새 설명은 사용자가 프로젝트를
  // 바꿨다 돌아올 때까지 화면에 없다.
  //
  // **실린 값을 비교하지 않는다.** main 은 프로젝트 키를 원 저장소로 접어 쓰는데(설계 D1) 렌더러는
  // 그 접기를 모른다 — 워크트리를 열고 있으면 밀려 오는 키는 이 창의 currentProject 와 다르다.
  // 그래서 어느 프로젝트의 것이든 다시 읽기만 한다: 접기를 아는 쪽(understanding.get)이 답한다.
  useEffect(() => {
    return window.api.on('understanding:changed', () => setUnderstandingSeq((n) => n + 1))
  }, [])

  // A task started, was completed/cancelled, or was interrupted — the collector's onTasksChanged
  // fires for all of these (collector.ts). Same shape as the listener just above — still not
  // comparing the pushed key against currentProject, even though this one is never folded (unlike
  // 'understanding:changed''s payload): it is just a "read again" signal, so the value carried does
  // not need to be checked before triggering the same unconditional re-read through sessionTasks.list.
  useEffect(() => {
    return window.api.on('sessionTasks:changed', () => setSessionTasksSeq((n) => n + 1))
  }, [])

  // The person typed /goal while a unit was already open on that session, so it opened nothing.
  // Silence would read as the feature being broken, and the toast carries a button that closes
  // the unit in the way — reusing completeOpenTask, the same call the row's own [완료] does.
  useEffect(
    () =>
      window.api.on('sessionTasks:goalIgnored', ({ projectPath, blockingUnitId }) => {
        // Dismissed the instant the button is pressed, not once completeOpenTask resolves — that is
        // what tells the person the press was accepted. Any outcome (hiw.open.completeEmpty, or an
        // error) arrives as its own toast afterwards.
        const id = toast.info(t('hiw.goal.ignored'), {
          action: {
            label: t('hiw.open.complete'), // same label as the row's own [완료] — same action, one key
            onClick: () => {
              dismiss(id)
              completeOpenTask(projectPath, blockingUnitId)
            }
          }
        })
      }),
    [t]
  )

  // When the project changes, that project's terminal list is read again — main holds them per project,
  // so another project's terminals stay alive and are simply not shown here
  useEffect(() => {
    // bottomRoot 로 읽는다 — 프로젝트가 없으면 홈의 터미널 목록이다. currentProject 로 걸러 두면
    // 프로젝트 없이 연 터미널이 목록에 잡히지 않아 탭이 빈 껍데기가 된다.
    if (!bottomRoot) {
      setTerminals([])
      return
    }
    let cancelled = false
    void window.api.terminal.list(bottomRoot).then(
      (list) => {
        if (cancelled) return
        setTerminals(list)
        // If a tab that does not belong to this project is still active, fall back to Run
        setBottomTab((cur) => (cur === 'run' || list.some((x) => x.id === cur) ? cur : 'run'))
      },
      () => {
        if (!cancelled) setTerminals([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [bottomRoot])

  // An event subscription (refreshed by run:status) plus one initial query, instead of polling all active runs
  useEffect(() => {
    void window.api.run.listActive().then(setActiveRuns)
    const off = window.api.on('run:status', (s) => {
      void window.api.run.listActive().then(setActiveRuns)
      // If the run belongs to the current workbench project, the local list is updated too — by runId,
      // and evicting whatever else holds that seat (a restart's replacement arrives on the old seat)
      if (currentProjectRef.current && s.projectPath === currentProjectRef.current) setRuns((prev) => upsertRun(prev, s))
      // Auto-open (the frontend preview design, §4). RunManager reports a start as one 'running' status
      // event, so this is a start, not a later change. Only the project on screen — a preview must not
      // pop over another project — and never a validation run, which nobody pressed ▶ on.
      if (s.status === 'running' && !s.validation && s.projectPath === currentProjectRef.current) {
        const cfg = runConfigsRef.current.find((c) => c.id === s.configId)
        if (cfg && cfg.type !== 'compound' && cfg.previewUrl)
          openBrowserTabRef.current(previewTargetOf(cfg.previewUrl), { awaitRunId: s.runId })
      }
      // The address a run printed, offered once. The run's tab keeps a button for it afterwards, so
      // this is only here to say the preview exists at all — the thing nobody finds on their own.
      // Not for a configured previewUrl, which has already opened itself, and not for a validation run.
      if (
        s.detectedUrl !== undefined &&
        s.status === 'running' &&
        !s.validation &&
        s.projectPath === currentProjectRef.current &&
        !previewOfferedRef.current.has(s.runId)
      ) {
        previewOfferedRef.current.add(s.runId)
        const cfg = runConfigsRef.current.find((c) => c.id === s.configId)
        const url = s.detectedUrl
        if (!(cfg && cfg.type !== 'compound' && cfg.previewUrl))
          toast.info(t('run.panel.previewFound', { url: displayHostOf(url) }), {
            action: { label: t('run.panel.previewOpen'), onClick: () => openBrowserTabRef.current(previewTargetOf(url)) }
          })
      }
    })
    return off
  }, [])

  // The console follows a chain: run.start returns the chain's first run (which runStart selects and
  // opens the panel on), and this arrives when the configuration the user actually pressed ▶ on
  // starts. The project check is the same one the run:status subscription makes, and for the same
  // reason — a run from a project the user has since switched away from must not take the selection.
  // run:launchFailed carries the same guard, for the same reason: a chain that fails in a project the
  // user is no longer looking at must not toast over whatever project they switched to.
  // The effect has no dependencies, so the open project is read through the ref, not the closure.
  useEffect(() => {
    const offFocus = window.api.on('run:focus', ({ runId, projectPath }) => {
      if (currentProjectRef.current === projectPath) setSelectedRunId(runId)
    })
    const offFailed = window.api.on('run:launchFailed', ({ message, projectPath }) => {
      if (currentProjectRef.current === projectPath) toast.error(message)
    })
    return () => {
      offFocus()
      offFailed()
    }
  }, [])

  // A preview page asked for a window. Main denied it and sent the address; the link rule routes it.
  useEffect(() => window.api.on('preview:popup', ({ url }) => openUrlRef.current(url)), [])

  // The agent browser: main asks for a session's tab, asks it closed, and reports whether a script is
  // running in it — see CoreEvents' preview:agentTab / preview:agentTabClose / preview:agentBusy.
  useEffect(() => window.api.on('preview:agentTab', ({ sessionId, cwd, url }) => openAgentTabRef.current(sessionId, cwd, url)), [])
  // The agent app workspaces (agent workspace design): the live ones once at mount, then every change.
  useEffect(() => {
    void window.api.workspace.list().then((list) => {
      const listed = mirrorsFromList(list)
      // The frames go to their store, not into the state (second pass R2-3).
      for (const [id, m] of Object.entries(listed)) {
        if (m.frame) mirrorFrames.set(id, m.frame)
        listed[id] = { ...m, frame: null }
      }
      takeMirrors({ ...mirrorsRef.current, ...listed }, mirrorsRef.current)
    })
  }, [])
  useEffect(() => window.api.on('workspace:event', (e) => takeMirrors(takeWorkspaceEvent(mirrorsRef.current, e, mirrorFrames), mirrorsRef.current)), [])
  useEffect(() => window.api.on('preview:agentTabClose', ({ sessionId }) => closeAgentTabRef.current(sessionId)), [])
  useEffect(() => window.api.on('preview:agentBusy', ({ sessionId, busy }) => {
    setAgentBusy((prev) => (busy ? { ...prev, [sessionId]: true } : (({ [sessionId]: _b, ...rest }) => rest)(prev)))
    // A run starts with no arrow: see agentPointer's comment. setBusy(true) is sent before the script
    // runs, over the same ordered channel, so this cannot race the new run's first point.
    if (busy) setAgentPointer((prev) => (({ [sessionId]: _p, ...rest }) => rest)(prev))
  }), [])
  useEffect(() => window.api.on('preview:agentPointer', ({ sessionId, x, y, w, h, kind }) => setAgentPointer((prev) => ({ ...prev, [sessionId]: { x, y, w, h, kind, seq: (prev[sessionId]?.seq ?? 0) + 1 } }))), [])

  // The selection must never name a run the list no longer holds — with nothing to draw, the Run tab
  // shows an empty console and no row highlighted. runStart and runDismiss keep it right for what the
  // user does here, but a seat can also be taken over by a run this renderer did not ask for: an
  // orchestration validation run (ipc.ts, validation: true) reuses the earliest finished row's seat of
  // its configuration, and upsertRun then evicts the run that held it.
  useEffect(() => {
    if (runs.some((r) => r.runId === selectedRunId)) return
    const next = pickRunToShow(runs)
    if (next !== selectedRunId) setSelectedRunId(next)
  }, [runs, selectedRunId])

  // Re-detects run configurations when a seed source at the project root changes.
  // On the JVM side the build file **body** feeds the verdict too — adding the Spring Boot plugin to
  // build.gradle has to produce a bootRun seed, so a content change is as much a trigger as a creation.
  // Wrapper files are included as well: whether they exist changes the launcher choice (gradlew.bat,
  // ./gradlew, or gradle).
  useEffect(() => {
    const SEED_FILES = new Set([
      'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.toml', 'go.mod',
      'build.gradle', 'build.gradle.kts', 'gradlew', 'gradlew.bat',
      'pom.xml', 'mvnw', 'mvnw.cmd',
      // These two do not seed a config (python/pytest have none — see hasPythonProject), but their
      // presence is what flips RunTypePicker's "detected" grouping, so they still belong in this set.
      // A root-level *.py file flips it too, but that is any of countless names and does not fit a
      // fixed set — the picker just does not update live for that trigger until the project reopens.
      'pyproject.toml', 'requirements.txt',
      // Same situation for 'dockerfile' — no seed, but its presence flips the picker's detection (hasDockerfile)
      'Dockerfile'
    ])
    const norm = (p: string): string => foldPathCase(p.replace(/\\/g, '/'), window.api.platform)
    // A batch is one watcher window — seed files touched together (a git checkout) re-read the run list once
    const off = onFileChanges((batch) => {
      const root = currentProjectRef.current
      if (!root) return
      const touchesSeed = batch.changes.some((c) => {
        const base = c.path.split(/[\\/]/).pop() ?? ''
        return SEED_FILES.has(base) && norm(parentDir(c.path)) === norm(root)
      })
      if (!touchesSeed) return
      void window.api.run.list(root).then((r) => {
        setRunConfigs(r.configs)
        setRunIsSpringBoot(r.isSpringBoot)
        setRunIsPythonProject(r.isPythonProject)
        setRunHasDockerfile(r.hasDockerfile)
        setRunContext(r.context)
        // 이 효과는 의존성이 [] 라 클로저의 currentProject 가 낡는다 — 위에서 ref 로 읽어 둔
        // root 가 지금 열린 프로젝트다. 기억을 그 키로 읽고 써야 다른 프로젝트 것을 건드리지 않는다.
        applyRunSelection(
          root,
          pickRunSelection(r.configs, runSelectedByProject.current[root], r.runs.find((x) => x.status !== 'exited')?.configId)
        )
      }).catch((err: unknown) => console.warn('Run config refresh after a seed file change failed', err))
    })
    return off
  }, [])
  return {
    
  }
}
