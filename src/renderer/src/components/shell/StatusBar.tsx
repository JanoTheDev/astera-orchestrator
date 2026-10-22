// The status bar (DESIGN-W11 §8): on the left the work (consoles → Agents, "n working", "n needs you" → the bell, the
// next queued plan), on the right the shown account's usage as words ("5h 16% · week 40%") and the Host as a word.
// Zero counts are hidden; sans, not mono.
import { HostRuntimeNotice } from '../HostRuntimeNotice'
import { openPage } from './navigation'
import { openBell } from './NotificationBell'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

/** Time left until the reset, as a relative countdown: '47m', '3h 54m', '2d 3h', '5d'.
 *  (Minutes round up; null once it has passed.) */
export function formatResetHud(resetsAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!resetsAt) return null
  const t = new Date(resetsAt).getTime()
  if (Number.isNaN(t)) return null
  const ms = t - nowMs
  if (ms <= 0) return null
  const diffMins = Math.ceil(ms / 60_000)
  if (diffMins < 60) return `${diffMins}m`
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/** One usage window as text ("5h 16%"), its reset countdown in the title. No reading shows nothing. */
function UsageWindow({ text, percent, resetsAt, title, t }: { text: 'shell.status.usage5h' | 'shell.status.usageWeek'; percent?: number; resetsAt?: string | null; title: string; t: AppState['t'] }): React.JSX.Element | null {
  if (typeof percent !== 'number') return null
  const reset = formatResetHud(resetsAt)
  return (
    <span className="sb-usage" title={reset ? `${title} · ${t('shell.status.resets', { time: reset })}` : title}>
      {t(text, { percent: Math.round(percent) })}
    </span>
  )
}

export type StatusBarProps = Pick<
  AppState,
  'appVersion' | 'hostRestarting' | 'hostRuntime' | 'hostRuntimeNow' | 'hostStatus' | 'restartHost' | 't'
> &
  Pick<ShellState, 'counts' | 'needsYouUnread' | 'nextQueued' | 'shellAccount' | 'shellUsage'>

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  const { appVersion, counts, needsYouUnread, hostRestarting, hostRuntime, hostRuntimeNow, hostStatus, nextQueued, restartHost, shellAccount, shellUsage, t } = p
  const hostOk = !!hostStatus?.connected && !hostStatus.outdated && !hostStatus.unresponsive
  return (
    <>
      <div className="statusbar sb">
        <button type="button" className="sb-item" onClick={() => openPage('agents')}>
          {counts.consoles === 0
            ? t('shell.status.noConsoles')
            : t(counts.consoles === 1 ? 'shell.status.consoleN' : 'shell.status.consolesN', { n: counts.consoles })}
        </button>
        {counts.working > 0 && (
          <button type="button" className="sb-item" onClick={() => openPage('agents')}>
            <span className="sb-dot sb-dot--ok" aria-hidden="true" />
            {t('shell.status.working', { n: counts.working })}
          </button>
        )}
        {needsYouUnread > 0 && (
          <button type="button" className="sb-item sb-item--warn" onClick={openBell}>
            <span className="sb-dot sb-dot--warn" aria-hidden="true" />
            {t('shell.status.needsYou', { n: needsYouUnread })}
          </button>
        )}
        {nextQueued && <span className="sb-next">{nextQueued}</span>}
        <span className="sp" />
        {shellAccount && (
          <span className="sb-account">
            <span className="sb-dot" style={{ background: shellAccount.color }} aria-hidden="true" />
            <span className="sb-account-name">{shellAccount.label}</span>
            <UsageWindow t={t} text="shell.status.usage5h" percent={shellUsage?.session?.usedPercent} resetsAt={shellUsage?.session?.resetsAt} title={t('session.usage.fiveHourTitle')} />
            <UsageWindow t={t} text="shell.status.usageWeek" percent={shellUsage?.weekly?.usedPercent} resetsAt={shellUsage?.weekly?.resetsAt} title={t('session.usage.weekly')} />
          </span>
        )}
        {hostOk ? (
          <span className="sb-host" title={hostStatus?.hostVersion ? t('shell.status.hostTitle', { version: hostStatus.hostVersion }) : 'Host'}>
            {t('shell.status.connected')}
          </span>
        ) : (
          !hostStatus?.connected && <span className="sb-host sb-host--warn">{t('shell.status.hostOffline')}</span>
        )}
        {/* The Host outlived an update and still runs the previous build. It replaces itself the first
            moment it holds nothing (host-replacement design §4), which for someone who keeps sessions
            open never comes — and until then 대화 sessions cannot be started at all, because the old
            Host does not speak proc-*. That was only ever said in Settings > Info, a place nobody
            visits to find out why a feature they were not told about is missing.

            Outside the `active` branches above on purpose: the Host's state is the same fact whether or
            not a session is showing, and the two branches would otherwise each need their own copy. */}
        {/* The Host's own runtime being put in place after an update (stage 3 task 2): the copy used to
            freeze the window with nothing on screen. Beside the other Host notices, for the same reason
            they are outside the session branches. */}
        <HostRuntimeNotice state={hostRuntime} nowMs={hostRuntimeNow} />
        {hostStatus?.connected && hostStatus.outdated && (
          <button
            type="button"
            className="status-host-outdated"
            disabled={hostRestarting}
            onClick={() => void restartHost()}
            title={t('status.hostOutdatedTitle', {
              host: hostStatus.hostVersion ?? '?',
              app: appVersion
            })}
          >
            {hostRestarting ? t('settings.info.hostRestarting') : t('status.hostOutdated')}
          </button>
        )}
        {/* The Host stopped answering. The same place and the same amber as the notice above, because
            it is the same kind of fact and a person should not have to learn two — but it is the more
            urgent of the two: sessions started from here on end with the app, and the only way back is
            this button (docs/2026-09-22-host-unresponsive-recovery-design.md F5). Before this, the one
            place that said anything was Settings > Info, and what it said was "연결 안 됨". */}
        {hostStatus?.unresponsive && (
          <button
            type="button"
            className="status-host-outdated"
            disabled={hostRestarting}
            onClick={() => void restartHost()}
            title={t('status.hostUnresponsiveTitle')}
          >
            {hostRestarting ? t('settings.info.hostRestarting') : t('status.hostUnresponsive')}
          </button>
        )}
      </div>
    </>
  )
}
