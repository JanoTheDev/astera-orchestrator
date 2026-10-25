// DESIGN-W13 §6: the panel's Activity tab, "Handled for you": the coordinator's event log as a dense list grouped by day
// (time · what happened · plan), each row leading to its plan or Task (its console when it names no plan), with a text
// filter. Drawing only: the lines are the Host's (core/orchestration/activity.ts), the words activityView.ts's.
import { useEffect, useMemo, useState } from 'react'
import type { Account } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Icon, Input, Menu, menuPointOf, type IconName } from '../ui'
import { goTo } from '../inbox/InboxPage'
import { itemMenuOf } from '../inbox/itemMenu'
import { openConsole } from '../shell/navigation'
import { lineTargetOf } from '../inbox/inboxNav'
import { byDay, handledOf, type HandledLine } from '../inbox/inboxView'
import { useActivityFeed } from './useActivityFeed'
import { filterLines, type Tone } from './activityView'
import './activity.css'

/** Status needs a second cue (DESIGN-W13 §11): each line leads with its tone's icon. */
const TONE_ICON: Record<Tone, IconName> = { ok: 'done', bad: 'error', warn: 'warning', info: 'pending' }
const MAX_LINES = 500

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ActivityPanel({
  planId,
  accounts
}: {
  /** The plan whose workspace is open, or null: the feed then shows every plan. */
  planId: string | null
  accounts: Account[] | null
  /** Kept for the panel host's call; a row opens its console through the inbox's shared navigation. */
  onOpenSession?: (sessionId: string, jobId: string) => void
}): React.JSX.Element {
  const { t, lang } = useI18n()
  const events = useActivityFeed(true)
  const [all, setAll] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; l: HandledLine } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const scope = planId !== null && !all ? planId : undefined
  const handled = useMemo(() => filterLines(handledOf(events, { group: 'all', ...(scope !== undefined ? { planId: scope } : {}) }, label, MAX_LINES, lang), query), [events, scope, query, accounts, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => byDay(handled, nowMs, t), [handled, nowMs, t])

  return (
    <section className="act" aria-label={t('inbox.handled')}>
      <div className="act__bar">
        <Input className="act__filter" type="search" value={query} placeholder={t('activity.filter')} aria-label={t('activity.filter')} onChange={(e) => setQuery(e.target.value)} />
        {planId !== null && (
          <Button variant="ghost" size="sm" aria-pressed={all} title={all ? t('activity.panel.onlyOpen') : t('activity.panel.everyPlan')} onClick={() => setAll((v) => !v)}>
            {all ? t('activity.panel.thisPlan') : t('activity.panel.allPlans')}
          </Button>
        )}
      </div>
      {handled.length === 0 && <p className="act__none">{query.trim() === '' ? t('inbox.handledEmpty') : t('activity.noMatch')}</p>}
      {days.map((d) => (
        <div key={d.day} className="act__day">
          <h3 className="act__day-h">{d.label}</h3>
          <ul className="act__feed">
            {d.lines.map((l) => {
              const target = lineTargetOf(l)
              return (
                <li
                  key={l.id}
                  className={`act__line act__line--${l.tone}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ at: menuPointOf(e), l })
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="act__row"
                    disabled={target === null}
                    title={[l.text, l.who].filter(Boolean).join('\n')}
                    icon={<Icon name={TONE_ICON[l.tone]} size={14} className="act__tone" />}
                    onClick={() => target && goTo(target)}
                  >
                    <span className="act__time">{timeOf(l.at)}</span>
                    <span className="act__text">{l.text}</span>
                    {l.plan && <span className="act__plan">{l.plan}</span>}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {menu && (
        <Menu
          at={menu.at}
          items={itemMenuOf({ target: lineTargetOf(menu.l), sessionId: menu.l.sessionId, text: menu.l.text }, false, { open: goTo, console: openConsole, setRead: () => {}, copy: (text) => window.api.clipboard.writeText(text) }, t)}
          onClose={() => setMenu(null)}
          label={t('inbox.handled')}
        />
      )}
    </section>
  )
}
