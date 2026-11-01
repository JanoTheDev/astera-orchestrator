// The parts of "Restart the Host now" (T15) that are decisions rather than wiring: when the button shows, how a
// restart's progress reads, and what a handover file says was handed over. Pure and node-free, so the app's main
// process (main/ipc.ts) and the window (StatusBar, Settings › Info) read the same answer and a test can reach it.
import type { MessageKey, MessageParams } from '../i18n'
import type { HostRestartState, HostStatus } from '../types'

/** `2:10` for 130 000 ms: what is left of the wait for the safe point. Rounds up, so the last second still reads 0:01. */
export function formatRestartLeft(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** What `HostStatus.replacement` is for the window: a swap or a manual offer main already set stays as it is, else
 *  `offered` for a Host that is connected, answering and older than the app. The button is there from the first
 *  moment the Host is outdated, not only after the automatic swap has waited 30 minutes. */
export function hostReplacementFor(
  s: Pick<HostStatus, 'connected' | 'outdated' | 'unresponsive'>,
  current: 'swapping' | 'manual' | null
): 'swapping' | 'manual' | 'offered' | null {
  if (current) return current
  return s.connected && s.outdated && !s.unresponsive ? 'offered' : null
}

/** Whether "Restart now" shows: the Host is connected, answering and older than the app, nothing is swapping it, and no
 *  restart is under way (its progress takes the button's place; a finished one stays until the window clears it). */
export function hostRestartOffered(s: HostStatus | null | undefined): boolean {
  if (!s || !s.connected || s.unresponsive || !s.outdated) return false
  if (s.replacement === 'swapping') return false
  return s.restart === undefined || s.restart.phase === 'failed'
}

/** Whether a restart is under way, so the window shows its progress instead of the offer. */
export function hostRestartRunning(r: HostRestartState | undefined): boolean {
  return r !== undefined && (r.phase === 'waiting' || r.phase === 'swapping')
}

/** Whether "Restart anyway" shows: Tasks are still being waited for and the wait has not run out. */
export function hostRestartCanForce(r: HostRestartState | undefined): boolean {
  return r?.phase === 'waiting' && r.waiting > 0 && r.leftMs > 0
}

/** One restart state as the catalog key and the values that make its sentence:
 *  "Holding new starts · waiting for 3 workers to reach a safe point (2:10 left)", "Restarted · 12 sessions resumed". */
export function hostRestartMessage(r: HostRestartState): { key: MessageKey; params?: MessageParams } {
  switch (r.phase) {
    case 'waiting':
      // Nothing left to wait for, or the wait ran out / was cut short: the hand-over is what is happening now.
      if (r.waiting === 0 || r.leftMs <= 0) return { key: 'status.hostRestartHandingOver' }
      return { key: 'status.hostRestartWaiting', params: { n: r.waiting, left: formatRestartLeft(r.leftMs) } }
    case 'swapping':
      return { key: 'status.hostRestartSwapping' }
    case 'done':
      return { key: 'status.hostRestartDone', params: { n: r.resumed } }
    case 'failed':
      switch (r.reason) {
        case 'quitting':
          return { key: 'status.hostRestartQuitting' }
        case 'refused':
          return { key: 'status.hostRestartRefused', params: { n: r.tasks ?? 0 } }
        case 'timeout':
          return { key: 'status.hostRestartTimeout' }
        case 'no-host':
          return { key: 'status.hostRestartNoHost' }
        case 'not-back':
          return { key: 'status.hostRestartNotBack' }
      }
  }
}

/** How many sessions a handover file (`<profile>/host/handover.json`, host/sessionRestore.ts `Handover`) carries: its
 *  agent sessions and its chats, the ones the next Host resumes and counts in "N sessions resumed". The terminals and
 *  runs it also carries are not sessions. 0 for anything that does not read as a handover. Never throws. */
export function handoverSessionCount(raw: string): number {
  try {
    const v = JSON.parse(raw) as { sessions?: unknown; chats?: unknown } | null
    const n = (x: unknown): number => (Array.isArray(x) ? x.length : 0)
    return v && typeof v === 'object' ? n(v.sessions) + n(v.chats) : 0
  } catch {
    return 0
  }
}
