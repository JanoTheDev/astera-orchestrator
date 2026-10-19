import type { AccountUsage, RateLimitWindow } from '../../../core/types'
import { coarseDuration } from '../../../core/usage/relativeTime'
import { useI18n } from '../i18n/I18nProvider'
import { Meter } from './ui'

/** Is there anything to draw? Shared so the meter, the detail and the row that decides whether it
 *  is clickable at all cannot drift apart about what "empty" means. */
export const hasUsage = (u: AccountUsage | undefined): u is AccountUsage =>
  !!u && !!(u.session || u.weekly)

// W9-B: every usage display is the house Meter (components/ui), on its usage-guard thresholds (75 warn, 90 danger).
// W11: each track is labelled with its window and percent. A missing window is an empty track with a dash, so the pair
// keeps its height and the row does not shift.
const track = (label: string, w: RateLimitWindow | null): React.JSX.Element => (
  <span className="acct-meter__line">
    <span className="acct-meter__k">{label}</span>
    <Meter value={w?.usedPercent ?? 0} className="acct-meter__t" />
    <span className="acct-meter__v">{w ? `${Math.round(w.usedPercent)}%` : '–'}</span>
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
 * Nothing at all is drawn when there is no reading — an account that is not logged in, one whose
 * provider endpoint has never answered for it, and a reading discarded past its reset all arrive here
 * as `undefined`. A dash was considered and rejected: it reads as 0%, not as "no value".
 *
 * Both providers reach here the same way. Claude and Codex each report a 5-hour and a weekly window,
 * so the two tracks mean the same thing on either row and nothing branches on provider.
 */
export function AccountUsageMeter({
  usage
}: {
  usage: AccountUsage | undefined
}): React.JSX.Element | null {
  const { t } = useI18n()
  if (!hasUsage(usage)) return null
  return (
    <span className={usage.remembered ? 'acct-meter stale' : 'acct-meter'}>
      {track(t('account.usage.fiveHour'), usage.session)}
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
  usage
}: {
  usage: AccountUsage | undefined
}): React.JSX.Element | null {
  const { t, lang } = useI18n()
  if (!hasUsage(usage)) return null

  const line = (label: string, w: RateLimitWindow): React.JSX.Element => {
    // A window whose reset has already passed, or that never carried one, shows its figure and no
    // time — a negative countdown is worse than a blank column.
    const untilMs = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : NaN
    const resets =
      Number.isFinite(untilMs) && untilMs > 0
        ? t('account.usage.resetsIn', { d: coarseDuration(untilMs, lang) })
        : ''
    return (
      <span className="dline" key={label}>
        <span className="k">{label}</span>
        <span className="v">{`${Math.round(w.usedPercent)}%`}</span>
        <Meter value={w.usedPercent} className="t" />
        <span className="r">{resets}</span>
      </span>
    )
  }

  const agoMs = Date.now() - Date.parse(usage.readAt)
  const ago = Number.isFinite(agoMs)
    ? t('account.usage.refreshedAgo', { d: coarseDuration(agoMs, lang) })
    : null

  return (
    <span className="acct-detail">
      {usage.session && line(t('account.usage.fiveHour'), usage.session)}
      {usage.weekly && line(t('account.usage.weekly'), usage.weekly)}
      {usage.remembered && ago && <span className="acct-detail-stale">{ago}</span>}
    </span>
  )
}
