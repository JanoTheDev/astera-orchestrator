// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { HostRuntimeNotice } from '../HostRuntimeNotice'
import type { AppState } from '../../state/appState'

/** Time left until the reset, as a relative countdown: '47m', '3h 54m', '2d 3h', '5d'.
 *  (Minutes round up; null once it has passed.) */
function formatResetHud(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null
  const t = new Date(resetsAt).getTime()
  if (Number.isNaN(t)) return null
  const ms = t - Date.now()
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

/** The status bar usage chip — a mini progress bar plus n%. Colours: green below 70, yellow 70–84,
 *  red at 85 and above. With no value, an empty bar and '–'. Given resetsAt, a dim '(resets in N)'
 *  sits next to it. */
function UsageChip({
  label,
  percent,
  resetsAt,
  title
}: {
  label: string
  percent?: number
  resetsAt?: string | null
  title?: string
}): React.JSX.Element {
  const has = typeof percent === 'number'
  const pct = has ? Math.max(0, Math.min(100, percent as number)) : 0
  const level = !has ? 'na' : pct >= 85 ? 'crit' : pct >= 70 ? 'warn' : 'ok'
  const reset = has ? formatResetHud(resetsAt) : null
  return (
    <span className="status-metric" title={title}>
      <span className="metric-label">{label}</span>
      <span className="usage-bar" aria-hidden="true">
        <span className={`usage-bar-fill ${level}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="metric-pct">{has ? `${percent}%` : '–'}</span>
      {reset && <span className="metric-reset">({reset})</span>}
    </span>
  )
}

export type StatusBarProps = Pick<
  AppState,
  'accounts' | 'active' | 'activeRemote' | 'appVersion' | 'hostRestarting' | 'hostRuntime' | 'hostRuntimeNow' |
  'hostStatus' | 'remoteStatus' | 'restartHost' | 'runtimeName' | 'sessions' | 't' | 'usage'
>

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  const {
    accounts, active, activeRemote, appVersion, hostRestarting, hostRuntime, hostRuntimeNow, hostStatus,
    remoteStatus, restartHost, runtimeName, sessions, t, usage
  } = p
  return (
    <>
      <div className="statusbar">
        {activeRemote ? (
          <>
            <span className="status-item">{activeRemote.title ?? activeRemote.sessionId}</span>
            <span className="status-item">{runtimeName(activeRemote.runtimeId)}</span>
            <span className="status-item status-path">{activeRemote.cwd}</span>
            <span className="status-item">{t(`remote.session.status.${remoteStatus[activeRemote.key] ?? 'unknown'}` as never)}</span>
          </>
        ) : active ? (
          <>
            <span className="status-account">
              <span
                className="status-dot"
                style={{ background: accounts.find((a) => a.id === active.accountId)?.color ?? '#888' }}
              />
              {accounts.find((a) => a.id === active.accountId)?.label}
            </span>
            <span className="status-item">{active.title}</span>
            <span className="status-item status-path">{active.cwd}</span>
            <span className="status-metrics">
              <UsageChip
                label="Context"
                percent={usage?.context?.usedPercent}
                title={
                  usage?.context
                    ? usage.context.usedTokens != null && usage.context.windowSize != null
                      ? t('session.usage.contextTitleWithTokens', {
                          used: usage.context.usedTokens.toLocaleString(),
                          window: usage.context.windowSize.toLocaleString()
                        })
                      : t('session.usage.contextTitle')
                    : t('session.usage.contextEmpty')
                }
              />
              <UsageChip
                label={t('session.usage.fiveHourLabel')}
                percent={usage?.session?.usedPercent}
                resetsAt={usage?.session?.resetsAt}
                title={t('session.usage.fiveHourTitle')}
              />
              <UsageChip
                label={t('session.usage.weekly')}
                percent={usage?.weekly?.usedPercent}
                resetsAt={usage?.weekly?.resetsAt}
                title={t('session.usage.weekly')}
              />
            </span>
            <span className="sp">{t('session.statusbar.count', { count: sessions.length })}</span>
          </>
        ) : (
          <>
            <span>{t('session.statusbar.none')}</span>
            <span className="sp">{t('session.statusbar.accountCount', { count: accounts.length })}</span>
          </>
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
