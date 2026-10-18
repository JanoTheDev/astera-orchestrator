// W6-G: the plan view's usage strip. Per account its 5-hour and 7-day share with the reset time, which accounts take
// no new worker (usageGuard.ts), the threshold, and the live subagents per tab against their limit.
import { useEffect, useState } from 'react'
import type { Account, JobTask, UsageGuardView } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { stripRows, USAGE_STRIP_POLL_MS, type StripWindow } from './usageView'
import { Meter } from '../ui'
import './usage.css'

export function UsageStrip({ accounts, tasks }: { accounts: readonly Account[] | null; tasks: readonly JobTask[] }): React.JSX.Element | null {
  const { t } = useI18n()
  const [view, setView] = useState<UsageGuardView | null>(null)

  useEffect(() => {
    let live = true
    const read = (): void => {
      window.api.usage.guard().then(
        (v) => live && setView(v),
        () => {
          // no answer this time: keep what is drawn, the next tick asks again
        }
      )
    }
    read()
    const timer = setInterval(read, USAGE_STRIP_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  if (view === null) return null
  const rows = stripRows(view, accounts, tasks)
  const win = (name: string, w: StripWindow | null): React.JSX.Element | null =>
    w === null ? null : (
      <span className={`usage-strip-window${w.over ? ' usage-strip-over' : ''}`}>
        {name} <Meter value={w.percent} className="usage-strip-meter" /> {w.percent}%{w.resets !== null && <span className="usage-strip-dim"> · {t('usage.strip.resets', { time: w.resets })}</span>}
      </span>
    )
  return (
    <div className="usage-strip" aria-label={t('usage.strip.label')}>
      <span className="usage-strip-title">{t('usage.strip.label')}</span>
      {rows.accounts.length === 0 && <span className="usage-strip-dim">{t('usage.strip.noReading')}</span>}
      {rows.accounts.map((a) => (
        <span key={a.accountId} className={`usage-strip-account${a.paused ? ' usage-strip-paused' : ''}`}>
          <strong>{a.label}</strong>
          {win(t('usage.strip.fiveHour'), a.fiveHour)}
          {win(t('usage.strip.sevenDay'), a.sevenDay)}
          {a.paused && <span className="usage-strip-flag">{t('usage.strip.paused')}</span>}
        </span>
      ))}
      <span className="usage-strip-dim">{t('usage.strip.threshold', { percent: rows.pauseAt })}</span>
      <span className="usage-strip-subagents">
        {t('usage.strip.subagents', { limit: rows.maxSubagents })}:{' '}
        {rows.subagents.length === 0 ? (
          <span className="usage-strip-dim">{t('usage.strip.noSubagents')}</span>
        ) : (
          rows.subagents.map((s) => (
            <span key={s.sessionId} className="usage-strip-tab" title={s.sessionId}>
              {s.label} {s.count}/{rows.maxSubagents}
            </span>
          ))
        )}
      </span>
    </div>
  )
}
