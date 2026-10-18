// The status bar (DESIGN.md §1, W9-B): consoles and working (→ Agents) · waiting for you (→ the Inbox) · the next
// queued plan · the shown account's 5-hour and weekly usage · host health. Usage is the house Meter, as everywhere.
import { HostRuntimeNotice } from '../HostRuntimeNotice'
import { Meter } from '../ui'
import { openInbox, openPage } from './navigation'
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

/** One usage window: label, Meter, n%, and the reset countdown. No reading draws an empty meter and '–'. */
function UsageWindow({ label, percent, resetsAt, title }: { label: string; percent?: number; resetsAt?: string | null; title: string }): React.JSX.Element {
  const has = typeof percent === 'number'
  const reset = has ? formatResetHud(resetsAt) : null
  return (
    <span className="status-metric" title={title}>
      <span className="metric-label">{label}</span>
      <Meter value={has ? percent : 0} className="status-meter" />
      <span className="metric-pct">{has ? `${Math.round(percent)}%` : '–'}</span>
      {reset && <span className="metric-reset">({reset})</span>}
    </span>
  )
}

export type StatusBarProps = Pick<
  AppState,
  'appVersion' | 'hostRestarting' | 'hostRuntime' | 'hostRuntimeNow' | 'hostStatus' | 'restartHost' | 't'
> &
  Pick<ShellState, 'counts' | 'nextQueued' | 'shellAccount' | 'shellUsage'>

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  const { appVersion, counts, hostRestarting, hostRuntime, hostRuntimeNow, hostStatus, nextQueued, restartHost, shellAccount, shellUsage, t } = p
  const hostOk = !!hostStatus?.connected && !hostStatus.outdated && !hostStatus.unresponsive
  return (
    <>
      <div className="statusbar">
        <button type="button" className="status-link" onClick={() => openPage('agents')}>
          <span className={counts.working > 0 ? 'status-dot status-dot--ok' : 'status-dot'} aria-hidden="true" />
          {counts.consoles} {counts.consoles === 1 ? 'console' : 'consoles'} · {counts.working} working
        </button>
        <button type="button" className={counts.waiting > 0 ? 'status-link status-link--warn' : 'status-link'} onClick={() => openInbox()}>
          <span className={counts.waiting > 0 ? 'status-dot status-dot--warn' : 'status-dot'} aria-hidden="true" />
          {counts.waiting} waiting for you
        </button>
        {nextQueued && <span className="status-item status-next">{nextQueued}</span>}
        <span className="sp" />
        {shellAccount && (
          <span className="status-account">
            <span className="status-dot" style={{ background: shellAccount.color }} aria-hidden="true" />
            {shellAccount.label}
            <UsageWindow
              label={t('session.usage.fiveHourLabel')}
              percent={shellUsage?.session?.usedPercent}
              resetsAt={shellUsage?.session?.resetsAt}
              title={t('session.usage.fiveHourTitle')}
            />
            <UsageWindow
              label={t('session.usage.weekly')}
              percent={shellUsage?.weekly?.usedPercent}
              resetsAt={shellUsage?.weekly?.resetsAt}
              title={t('session.usage.weekly')}
            />
          </span>
        )}
        {hostOk && (
          <span className="status-item status-host" title={hostStatus?.hostVersion ? `Host ${hostStatus.hostVersion}` : 'Host'}>
            Host ok
          </span>
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
