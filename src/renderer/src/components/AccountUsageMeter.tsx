import { Fragment } from 'react'
import type { AccountUsage, RateLimitWindow } from '../../../core/types'
import { coarseDuration } from '../../../core/usage/relativeTime'
import { useI18n } from '../i18n/I18nProvider'
import { Icon, Meter, meterTone } from './ui'
import { runOutOf, SESSION_WINDOW_MS, WEEKLY_WINDOW_MS } from './usage/runOut'

/** Is there anything to draw? Shared so the meter, the detail and the row that decides whether it
 *  is clickable at all cannot drift apart about what "empty" means. */
export const hasUsage = (u: AccountUsage | undefined): u is AccountUsage =>
  !!u && !!(u.session || u.weekly)

// W9-B: every usage display is the house Meter (components/ui), on its usage-guard thresholds (75 warn, 90 danger).
// W11: each track is labelled with its window and percent. A missing window is an empty track with a dash, so the pair
// keeps its height and the row does not shift.
// Second cue besides colour: past the usage-guard warn threshold a warning icon sits beside the figure.
const NearLimit = ({ percent }: { percent: number }): React.JSX.Element | null => {
  const { t } = useI18n()
  return meterTone(percent) === 'accent' ? null : (
    <Icon name="warning" size={14} label={t('account.usage.nearLimit')} className={`acct-near acct-near--${meterTone(percent)}`} />
  )
}

const track = (label: string, w: RateLimitWindow | null): React.JSX.Element => (
  <span className="acct-meter__line">
    <span className="acct-meter__k">{label}</span>
    <Meter value={w?.usedPercent ?? 0} className="acct-meter__t" />
    <span className="acct-meter__v">
      {w && <NearLimit percent={w.usedPercent} />}
      {w ? `${Math.round(w.usedPercent)}%` : '–'}
    </span>
  </span>
)

/**
 * The account row's two-track usage meter (design doc §5).
 *
 * W11: two labelled lines ("5h ▬ 12%", "Weekly ▬ 41%"), so the popover says as much as the status bar.
 * Before W11: 44px wide, two 3px tracks 2px apart, 8px tall. 44px was the width the status-bar
 * meter already uses, so the label loses nothing.
 *
 * The top track is always the 5-hour window and the bottom always weekly. The order never varies: the
 * detail names them, so it has to be learned exactly once.
 *
 * T4: an account with no 5-hour window (an Ultra plan, or a reading with a weekly window and no session window:
 * sessionWindow.ts) draws the weekly track alone. Its caller decides that with `hasSessionWindow` and passes
 * `sessionWindow={false}`; an account that has the window but no figure for it still draws the empty track.
 *
 * Nothing at all is drawn when there is no reading — an account that is not logged in, one whose
 * provider endpoint has never answered for it, and a reading discarded past its reset all arrive here
 * as `undefined`. A dash was considered and rejected: it reads as 0%, not as "no value".
 *
 * Both providers reach here the same way. Claude and Codex each report a 5-hour and a weekly window,
 * so the two tracks mean the same thing on either row and nothing branches on provider.
 */
export function AccountUsageMeter({
  usage,
  sessionWindow = true
}: {
  usage: AccountUsage | undefined
  /** False: the account has no 5-hour window (sessionWindow.ts), so only the weekly track is drawn. */
  sessionWindow?: boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  if (!hasUsage(usage)) return null
  return (
    <span className={usage.remembered ? 'acct-meter stale' : 'acct-meter'}>
      {sessionWindow && track(t('account.usage.fiveHour'), usage.session)}
      {track(t('account.usage.weekly'), usage.weekly)}
    </span>
  )
}

/**
 * The detail a row opens (design doc §5.1).
 *
 * It sits in flow on its own line inside the row, one row open at a time. It was an absolute overlay
 * first, so that a row could not grow under a travelling pointer and push the row someone was aiming
 * at out from under them — the failure that made a second permanent line and a naive
 * expand-in-place both unacceptable. Opening on a click rather than on hover removes that failure
 * instead of working around it: the pointer is already still, and already on the row it chose.
 *
 * Two lines, one per window, plus a third when the reading is remembered. There is no animation:
 * there is nothing here that a transition clarifies.
 */
export function AccountUsageDetail({
  usage,
  sessionWindow = true
}: {
  usage: AccountUsage | undefined
  /** As on AccountUsageMeter: false leaves the 5-hour line out. */
  sessionWindow?: boolean
}): React.JSX.Element | null {
  const { t, lang } = useI18n()
  if (!hasUsage(usage)) return null

  const line = (label: string, w: RateLimitWindow, windowMs: number): React.JSX.Element => {
    // A window whose reset has already passed, or that never carried one, shows its figure and no
    // time — a negative countdown is worse than a blank column.
    const untilMs = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : NaN
    const resets =
      Number.isFinite(untilMs) && untilMs > 0
        ? t('account.usage.resetsIn', { d: coarseDuration(untilMs, lang) })
        : ''
    const now = Date.now()
    const est = runOutOf(w, windowMs, now)
    const rate = est ? (est.ratePerHour < 10 ? est.ratePerHour.toFixed(1) : String(Math.round(est.ratePerHour))) : ''
    const runOut = !est
      ? ''
      : est.runsOutAt === null
        ? t('account.usage.lasts', { rate })
        : t('account.usage.runOut', { rate, duration: coarseDuration(est.runsOutAt - now, lang) })
    return (
      <Fragment key={label}>
        <span className="dline">
        <span className="k">{label}</span>
        <span className="v">
          <NearLimit percent={w.usedPercent} />
          {`${Math.round(w.usedPercent)}%`}
        </span>
        <Meter value={w.usedPercent} className="t" />
        <span className="r">{resets}</span>
        </span>
        {runOut && (
          <span className="dline dline--faint">
            {runOut}
          </span>
        )}
      </Fragment>
    )
  }

  const agoMs = Date.now() - Date.parse(usage.readAt)
  const ago = Number.isFinite(agoMs)
    ? t('account.usage.refreshedAgo', { d: coarseDuration(agoMs, lang) })
    : null

  return (
    <span className="acct-detail">
      {sessionWindow && usage.session && line(t('account.usage.fiveHour'), usage.session, SESSION_WINDOW_MS)}
      {usage.weekly && line(t('account.usage.weekly'), usage.weekly, WEEKLY_WINDOW_MS)}
      {usage.remembered && ago && <span className="acct-detail-stale">{ago}</span>}
    </span>
  )
}
