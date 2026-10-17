// W2-C task board: one column per bucket, each card with its model, account, branch, attempts and, when it is not
// running, why (core/orchestration/blocked.ts). Drawing only: the reasons and the counts are planBoard.ts's.
import { useEffect, useState } from 'react'
import type { Account, JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskGlyph } from '../JobIcons'
import { CATEGORIES, categoryOf, reasonText, reasonTone } from './planBoard'

/** How often the "resumes in …" text refreshes. */
const TICK_MS = 30_000

export function TaskBoard({
  tasks,
  accounts,
  selected,
  onSelect
}: {
  tasks: readonly JobTask[]
  accounts: Account[] | null
  selected: string | undefined
  onSelect: (taskId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const columns = CATEGORIES.map((c) => [c, tasks.filter((tk) => categoryOf(tk) === c)] as const).filter(
    ([, list]) => list.length > 0
  )
  return (
    <div className="plan-board">
      {columns.map(([c, list]) => (
        <section key={c} className={`plan-col plan-cat-${c}`} aria-label={t(`plan.cat.${c}`)}>
          <h3 className="plan-col-head">
            {t(`plan.cat.${c}`)} <span className="plan-count-n">{list.length}</span>
          </h3>
          {list.map((tk) => {
            const reason = tk.board?.reason
            const text = reason ? reasonText(reason, nowMs, label) : undefined
            const account = tk.accountId ?? tk.accountIds?.[0]
            return (
              <button
                key={tk.id}
                type="button"
                className={`plan-card${selected === tk.id ? ' selected' : ''}`}
                aria-pressed={selected === tk.id}
                onClick={() => onSelect(tk.id)}
              >
                <span className="plan-card-title">
                  <TaskGlyph task={tk} size={12} />
                  <span>{tk.title}</span>
                </span>
                {reason && text && (
                  <span className={`plan-reason plan-reason-${reasonTone(reason)}`}>{t(text.key, text.params)}</span>
                )}
                <dl className="plan-card-meta">
                  <dt>{t('plan.card.model')}</dt>
                  <dd>{tk.model ?? t('plan.card.cliDefault')}</dd>
                  {account !== undefined && (
                    <>
                      <dt>{t('plan.card.account')}</dt>
                      <dd>{label(account)}</dd>
                    </>
                  )}
                  {tk.branch !== undefined && (
                    <>
                      <dt>{t('plan.card.branch')}</dt>
                      <dd title={tk.branch}>{tk.branch}</dd>
                    </>
                  )}
                </dl>
                {tk.attempts !== undefined && <span className="plan-card-attempts">{t('plan.card.attempts', { n: tk.attempts })}</span>}
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
