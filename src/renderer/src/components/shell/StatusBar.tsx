// The status bar (DESIGN-W13 §7): on the left the project and its branch (→ Source Control), "n working" (→ Agents),
// "n need you" (→ the panel's Needs you) and the next queued plan; on the right the shown account's usage as words
// ("5h 16% · week 40%", → the accounts popover), the Host as a word, and the bell. Zero counts are hidden.
import { useEffect, useState } from 'react'
import { HostRuntimeNotice } from '../HostRuntimeNotice'
import { Button, Icon, StatusBarItem } from '../ui'
import { openActivity, openPanel } from './navigation'
import { NotificationBell } from './NotificationBell'
import { setAccountsOpen } from './ActivityBar'
import { openProjectSwitcher } from './ProjectSwitcher'
import { hostRestartCanForce, hostRestartMessage, hostRestartOffered, hostRestartRunning } from '../../../../core/host/restartView'
import type { HostStatus } from '../../../../core/types'
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
  | 'appVersion' | 'hostRestarting' | 'hostRuntime' | 'hostRuntimeNow' | 'hostStatus' | 'restartHost' | 't' | 'accounts'
  | 'actionUi' | 'scopedData' | 'scopedTree' | 'workspaceData' | 'workspaceTree' | 'workspaceProjectId' | 'currentProject'
> &
  Pick<ShellState, 'counts' | 'needsYouUnread' | 'nextQueued' | 'shellAccount' | 'shellUsage'> & {
    /** The project's branch (useCurrentBranch), or null. */
    branch: string | null
  }

/** The project folder's checked-out branch (git's HEAD), read when the project changes and when the window regains
 *  focus; null outside a repo or while unknown. */
export function useCurrentBranch(path: string | null): string | null {
  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    setBranch(null)
    if (!path) return
    let alive = true
    const read = (): void =>
      void window.api.worktrees.listBranches(path).then(
        (r) => alive && setBranch(r.branches?.find((b) => b.current && !b.remote)?.name ?? null),
        () => alive && setBranch(null)
      )
    read()
    window.addEventListener('focus', read)
    return () => {
      alive = false
      window.removeEventListener('focus', read)
    }
  }, [path])
  return branch
}

/** A restart's progress as one status item: a spinner while it runs, amber when it failed (core/host/restartView.ts says it). */
export function RestartProgressItem({ restart, t }: { restart: NonNullable<HostStatus['restart']>; t: AppState['t'] }): React.JSX.Element {
  const m = hostRestartMessage(restart)
  return (
    <StatusBarItem tone={restart.phase === 'failed' ? 'warn' : undefined} icon={hostRestartRunning(restart) ? <Icon name="loading" size={14} /> : undefined}>
      {t(m.key, m.params)}
    </StatusBarItem>
  )
}

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  const { appVersion, counts, needsYouUnread, hostRestarting, hostRuntime, hostRuntimeNow, hostStatus, nextQueued, restartHost, shellAccount, shellUsage, t } = p
  const { branch } = p
  // An outdated Host waiting for its swap is still connected and still working; only the button replaces that word.
  const swapping = hostStatus?.replacement === 'swapping'
  // The Host's restart (T15): its progress, or the offer of one. The offer replaces the word "connected", as the manual one did.
  const restart = hostStatus?.restart
  const restartOffer = hostRestartOffered(hostStatus)
  const hostOk = !!hostStatus?.connected && !hostStatus.unresponsive && !restartOffer && !(hostStatus.outdated && hostStatus.replacement === 'manual')
  const project = p.workspaceTree.find((x) => x.id === p.workspaceProjectId)?.name ?? p.currentProject?.split(/[\\/]/).filter(Boolean).pop()
  const five = shellUsage?.session?.usedPercent
  const week = shellUsage?.weekly?.usedPercent
  return (
    <>
      {/* DESIGN-W13 §7: accent-tinted only when the background service is offline */}
      <footer className={hostStatus && !hostStatus.connected && !swapping ? 'statusbar sb wb-status wb-status--alert' : 'statusbar sb wb-status'}>
        {project && (
          <StatusBarItem icon={<Icon name="branch" size={14} />} title={t('shell.status.projectTitle')} onClick={openProjectSwitcher}>
            <span className="wb-status__project">{project}</span>
            {branch && <span className="wb-status__branch">{branch}</span>}
          </StatusBarItem>
        )}
        {counts.working > 0 && (
          <StatusBarItem icon={<Icon name="loading" size={14} />} onClick={() => openActivity('agents')}>
            {t('shell.status.working', { n: counts.working })}
          </StatusBarItem>
        )}
        {needsYouUnread > 0 && (
          <StatusBarItem tone="warn" icon={<Icon name="circleAlert" size={14} />} onClick={() => openPanel('needs')}>
            {t('shell.status.needsYou', { n: needsYouUnread })}
          </StatusBarItem>
        )}
        {nextQueued && <span className="sb-next">{nextQueued}</span>}
        <span className="sp" />
        {shellAccount && (typeof five === 'number' || typeof week === 'number') && (
          <StatusBarItem title={t('settings.tab.accounts')} onClick={() => setAccountsOpen(true)}>
            <UsageWindow t={t} text="shell.status.usage5h" percent={five} resetsAt={shellUsage?.session?.resetsAt} title={t('session.usage.fiveHourTitle')} />
            {typeof five === 'number' && typeof week === 'number' && <span aria-hidden="true">·</span>}
            <UsageWindow t={t} text="shell.status.usageWeek" percent={week} resetsAt={shellUsage?.weekly?.resetsAt} title={t('session.usage.weekly')} />
          </StatusBarItem>
        )}
        {/* The automatic swap (T16) drops the connection on purpose for a few seconds: one short word, not "offline". */}
        {restart ? (
          <RestartProgressItem restart={restart} t={t} />
        ) : swapping ? (
          <StatusBarItem icon={<Icon name="loading" size={14} />}>{t('status.hostUpdating')}</StatusBarItem>
        ) : hostOk ? (
          <StatusBarItem title={hostStatus?.hostVersion ? t('shell.status.hostTitle', { version: hostStatus.hostVersion }) : t('shell.status.hostAbout')}>
            {t('shell.status.connected')}
          </StatusBarItem>
        ) : (
          !hostStatus?.connected && (
            <StatusBarItem tone="warn" title={t('shell.status.hostAbout')}>
              {t('shell.status.hostOffline')}
            </StatusBarItem>
          )
        )}
        {/* The Host outlived an update and still runs the previous build. It swaps itself, handing its sessions
            over, the first moment no Task is working (T16), so the button is only the fallback: main offers it
            (`replacement: 'manual'`) once that wait has run past 30 minutes, or at once for a Host too old to hand
            over.

            Outside the `active` branches above on purpose: the Host's state is the same fact whether or
            not a session is showing, and the two branches would otherwise each need their own copy. */}
        {/* The Host's own runtime being put in place after an update (stage 3 task 2): the copy used to
            freeze the window with nothing on screen. Beside the other Host notices, for the same reason
            they are outside the session branches. */}
        <HostRuntimeNotice state={hostRuntime} nowMs={hostRuntimeNow} />
        {/* T15: offered whenever the Host is older than the app, not only after the swap has waited 30 minutes. */}
        {restartOffer && hostStatus && (
          <>
            <span className="status-host-older">{t('status.hostRestartOffer', { host: hostStatus.hostVersion ?? '?', app: appVersion })}</span>
            <span className="status-host-older" aria-hidden="true">·</span>
            <Button
              variant="secondary"
              size="sm"
              className="status-host-outdated"
              loading={hostRestarting}
              onClick={() => void restartHost()}
              title={t('status.hostRestartOfferTitle', { host: hostStatus.hostVersion ?? '?', app: appVersion })}
            >
              {hostRestarting ? t('settings.info.hostRestarting') : t('settings.info.hostRestartNow')}
            </Button>
          </>
        )}
        {/* The workers that have not reached a safe point need not be waited for: hand over now. */}
        {hostRestartCanForce(restart) && (
          <Button
            variant="secondary"
            size="sm"
            className="status-host-outdated"
            onClick={() => void window.api.host.restartNow({ force: true })}
            title={t('status.hostRestartAnywayTitle')}
          >
            {t('status.hostRestartAnyway')}
          </Button>
        )}
        {/* The Host stopped answering. The same place and the same amber as the notice above, because
            it is the same kind of fact and a person should not have to learn two — but it is the more
            urgent of the two: sessions started from here on end with the app, and the only way back is
            this button (docs/2026-09-22-host-unresponsive-recovery-design.md F5). Before this, the one
            place that said anything was Settings > Info, and what it said was "연결 안 됨". */}
        {hostStatus?.unresponsive && (
          <Button
            variant="secondary"
            size="sm"
            className="status-host-outdated"
            loading={hostRestarting}
            onClick={() => void restartHost()}
            title={t('status.hostUnresponsiveTitle')}
          >
            {hostRestarting ? t('settings.info.hostRestarting') : t('status.hostUnresponsive')}
          </Button>
        )}
        <span className="wb-status__bell">
          <NotificationBell {...p} />
        </span>
      </footer>
    </>
  )
}
