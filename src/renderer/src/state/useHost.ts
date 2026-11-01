// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useRef, useState } from 'react'
import type { CliStatus, HostHoldings, HostStatus, HostRuntimeInstallState, UpdateStatus, UpdateCampaignInfo } from '../../../core/types'
import { confirmModal } from '../lib/confirm'
import { toast } from '../lib/toast'
import { sameOrNext } from '../lib/remoteSessions'
import { HOST_FEATURE_HANDOVER, HOST_FEATURE_RESTART } from '../../../core/host/protocol'
import type { useLayout } from './useLayout'

/** How often the Host's status is re-read. Slow on purpose: the only thing that changes without anyone
 *  asking is the Host replacing itself, which happens the first moment no Task works, and a notice
 *  that clears within half a minute of that is prompt enough for something nobody is waiting on. */
const HOST_STATUS_POLL_MS = 30_000

export type HostDeps = Pick<ReturnType<typeof useLayout>,
    't'>

export function useHost(deps: HostDeps) {
  const {
    t
  } = deps
  const [showNew, setShowNew] = useState(false)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null) // prefill for WorktreePanel's 'start session'
  // Two different questions, deliberately kept apart (the same split session/startBlocked.ts explains
  // for the new-session dialog). `cli` is runnability — `claude --version` actually ran and printed
  // this — and it is asked with no folder, so it answers for the app's own working directory and
  // nothing else. It feeds the version lines in Settings, where that is exactly the right answer.
  // `cliInstalled` is existence, asked of the machine's PATH and independent of any folder.
  const [cli, setCli] = useState<{ claude: CliStatus; codex: CliStatus } | null>(null)
  const [cliInstalled, setCliInstalled] = useState<{ claude: boolean; codex: boolean } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null)
  /** What the Host says it is holding, or null while it has not said — which is the state this
   *  starts in every time the modal opens, and the state it stays in when there is no Host, when the
   *  connection is down, and when the Host is too slow to answer. The row prints the clause only
   *  once this is filled: zeros would be a claim that nothing of the person's survives closing the
   *  app, and that is the one wrong answer worth avoiding here. */
  const [hostHolding, setHostHolding] = useState<HostHoldings | null>(null)
  // Read from the app's startup and kept current, not only while the Settings modal is open. It used
  // to be read on that open alone, on the reasoning that the Info row was the only thing that drew it
  // — true until the status bar started drawing the "Host update" notice, which is on screen the whole
  // time and would otherwise have stayed hidden until someone visited the very tab it exists to save
  // them a trip to. Polled rather than pushed because the fact changes without anyone asking: the Host
  // swaps itself the first moment no Task works (main/ipc.ts hostReplaceDue), and the notice has
  // to go away when it does. The call answers from inside this app — no round trip to the Host — so
  // the interval is cheap; the Host's own holdings, which are a round trip, stay where they were.
  useEffect(() => {
    let current = true
    const read = (): void => {
      void window.api.host
        .status()
        .then((s) => {
          if (current) setHostStatus((held) => sameOrNext(held, s))
        })
        .catch(() => {})
    }
    read()
    const timer = setInterval(read, HOST_STATUS_POLL_MS)
    // The poll is the floor, not the source. A Host that stops answering has to reach the screen at
    // once — the person is already looking at it, waiting for a session that is not coming — so main
    // pushes every transition and the poll is left in as a backstop for anything that never does.
    const off = window.api.host.onStatus((s) => {
      if (current) setHostStatus(s)
    })
    return () => {
      current = false
      clearInterval(timer)
      off()
    }
  }, [])
  /** Putting the Host's own runtime in place (stage 3 task 2), as main last said it. Read once at mount
   *  and then pushed; the notice it drives sits in the status bar beside the other Host notices. */
  const [hostRuntime, setHostRuntime] = useState<HostRuntimeInstallState | null>(null)
  useEffect(() => {
    let current = true
    void window.api.host
      .runtimeInstall()
      .then((s) => {
        if (current) setHostRuntime(s)
      })
      .catch(() => {})
    const off = window.api.host.onRuntimeInstall((s) => {
      if (current) setHostRuntime(s)
    })
    return () => {
      current = false
      off()
    }
  }, [])
  /** The clock the notice's elapsed seconds read, ticked once a second only while a slow install is on
   *  screen — the count moving is what tells a long antivirus scan from a hang. */
  const [hostRuntimeNow, setHostRuntimeNow] = useState(() => Date.now())
  const hostRuntimeSlow = hostRuntime?.phase === 'preparing' && hostRuntime.slow
  useEffect(() => {
    if (!hostRuntimeSlow) return
    setHostRuntimeNow(Date.now())
    const timer = setInterval(() => setHostRuntimeNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [hostRuntimeSlow])
  const [hostRestarting, setHostRestarting] = useState(false)
  /** **Restart the Host now** (T15), for a Host that can hand its sessions over: no question first, since nothing ends. The
   *  Host holds new starts and waits for the working Tasks to reach a safe point; main pushes that as `HostStatus.restart`,
   *  which the status bar and the Info tab show, with "Restart anyway". This resolves once the new Host answered or the
   *  restart failed (the sentence for either is in the status). */
  const restartHostNow = async (): Promise<void> => {
    setHostRestarting(true)
    try {
      await window.api.host.restartNow()
      const status = await window.api.host.status()
      setHostStatus(status)
      setHostHolding(status.connected ? await window.api.host.holdings().catch(() => null) : null)
    } finally {
      setHostRestarting(false)
    }
  }
  /** The Info tab's *Restart now* and the status bar's button. A Host that hands over (or restarts on request) goes the way
   *  above; one that is not answering, or too old to hand over, is first confirmed with what ends, then replaced, then the
   *  row is re-read. */
  const restartHost = async (): Promise<void> => {
    const features = hostStatus?.features ?? []
    if (hostStatus?.unresponsive !== true && (features.includes(HOST_FEATURE_RESTART) || features.includes(HOST_FEATURE_HANDOVER))) return restartHostNow()
    // **A Host that is not answering cannot be asked what it holds**, so `hostHolding` is null there
    // and staying silent about it would be the wrong kind of quiet — something does end. The app's own
    // count of sessions that outlive it is the honest answer: it is this app's record of what it
    // handed to that Host, which is exactly what goes away with it.
    const unresponsive = hostStatus?.unresponsive === true
    // Asked now: the status bar's button is pressed without the Info row ever having read it.
    const h = unresponsive ? null : await window.api.host.holdings().catch(() => hostHolding)
    const kept = unresponsive ? await window.api.host.sessionsOutlivingApp().catch(() => 0) : 0
    // A Host that hands over (HOST_FEATURE_HANDOVER, core/host/protocol.ts, which the renderer does not compile) brings
    // its sessions, terminals and runs back in the next one; an older one ends them, this one time.
    const handover = hostStatus?.features.includes('handover') === true
    // HOST_FEATURE_HANDOVER_CHATS: its chats come back too, respawned on their threads; the first handover build ends them.
    const handoverChats = hostStatus?.features.includes('handover-chats') === true
    const counts = h && { sessions: h.sessions, chats: h.chats, terminals: h.terminals, runs: h.runs }
    const body = unresponsive
      ? kept > 0
        ? t('settings.info.hostRestartUnresponsiveConfirmBody', { kept })
        : t('settings.info.hostRestartUnresponsiveConfirmBodyNone')
      : handover
        ? counts
          ? t(handoverChats ? 'status.hostHandoverChatsConfirmBody' : 'status.hostHandoverConfirmBody', counts)
          : t('status.hostHandoverConfirmBodyNone')
        : counts
          ? t('status.hostLegacyConfirmBody', counts)
          : t('status.hostLegacyConfirmBodyNone')
    const ok = await confirmModal({
      title: t(unresponsive ? 'settings.info.hostRestartUnresponsiveConfirmTitle' : 'settings.info.hostRestartConfirmTitle'),
      body,
      confirmLabel: t('settings.info.hostRestartNow')
    })
    if (!ok) return
    setHostRestarting(true)
    try {
      const was = hostStatus?.pid ?? null
      const status = await window.api.host.replace()
      // The same Host still there and still outdated: it refused the handover because a Task is working (main waits).
      if (!unresponsive && handover && status.connected && status.outdated && status.pid === was) toast.info(t('status.hostSwapWaits'))
      setHostStatus(status)
      setHostHolding(status.connected ? await window.api.host.holdings().catch(() => null) : null)
    } finally {
      setHostRestarting(false)
    }
  }
  // The moment the check finished has to be held alongside the state so the "checked at 17:43" line
  // can carry it. Events that are not results (checking, downloading) have no time.
  const [update, setUpdate] = useState<(UpdateStatus & { checkedAt: number | null }) | null>(null)
  const [checkClickedAt, setCheckClickedAt] = useState<number | null>(null)
  // The version a toast already announced. Re-checking reuses the cache and delivers downloaded again, so each version is announced once.
  const notifiedUpdateRef = useRef<string | null>(null)
  // The install toast on screen, so 'manual' can replace the 'downloaded' one rather than stack on it.
  const readyToastRef = useRef<number | null>(null)
  // The update campaign. A value is present only when this app is in the target range. It is a ref
  // because the onStatus subscription — registered once at mount — has to see the latest campaign (a
  // plain state would leave the closure stale).
  const [campaign, setCampaign] = useState<UpdateCampaignInfo | null>(null)
  const campaignRef = useRef<UpdateCampaignInfo | null>(null)
  return {
    showNew, setShowNew, newSessionCwd, setNewSessionCwd, cli, setCli, cliInstalled, setCliInstalled, appVersion,
    setAppVersion, hostStatus, setHostStatus, hostHolding, setHostHolding, hostRuntime, hostRuntimeNow,
    hostRestarting, restartHost, update, setUpdate, checkClickedAt, setCheckClickedAt, notifiedUpdateRef,
    readyToastRef, campaign, setCampaign, campaignRef
  }
}
