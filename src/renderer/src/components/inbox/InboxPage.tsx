// W9-D Inbox page (DESIGN.md §2 "Inbox"): two columns. Left, "Needs you": plan approvals, questions, escalations,
// Gates and permission waits, oldest first, each answered here. Right, "Handled for you": the W3-A feed.
// A permission prompt stays in the real CLI (CONTEXT rule 6), so its card only opens the console.
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Inbox as InboxIcon, TerminalSquare } from 'lucide-react'
import type { Account } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { localDoor, replyNote } from '../../lib/orchDoor'
import { Button, Card, Chip, EmptyState, Tabs, type TabItem } from '../ui'
import { openConsole, openPlan } from '../shell/navigation'
import { QuestionAnswer } from '../plan/QuestionAnswer'
import type { WorkspaceData, WorkspaceProject } from '../../state/workspaceTree'
import { setInboxFilter, useInboxRequest } from './inboxNav'
import { ageOf, filterNeeds, handledOf, whereOf, type InboxGroup, type NeedCard } from './inboxView'
import { useInbox } from './useInbox'
import './inbox.css'

const GROUPS: Array<[InboxGroup, MessageKey]> = [
  ['all', 'wall.filter.all'],
  ['approvals', 'inbox.group.approvals'],
  ['questions', 'inbox.group.questions'],
  ['permissions', 'inbox.group.permissions'],
  ['handled', 'inbox.group.handled']
]

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function InboxPage({
  tree,
  data,
  accounts,
  ui
}: {
  tree: readonly WorkspaceProject[]
  data: WorkspaceData | null
  accounts: Account[] | null
  /** The app's Job action ui (confirm dialogs, toasts), for Approve. */
  ui: ActionUi
}): React.JSX.Element {
  const { t } = useI18n()
  const { filter } = useInboxRequest()
  const { needs, events, pathOfJob } = useInbox(tree, data)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const shown = useMemo(() => filterNeeds(needs, filter), [needs, filter])
  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const handled = useMemo(() => handledOf(events, filter, label), [events, filter, accounts]) // eslint-disable-line react-hooks/exhaustive-deps
  const tabs: TabItem<InboxGroup>[] = GROUPS.map(([id, key]) => ({ id, label: t(key), ...(id === 'all' ? { count: needs.length } : {}) }))

  const doorOf = (jobId: string) => localDoor(window.api, pathOfJob.get(jobId) ?? tree[0]?.path ?? '')

  return (
    <div className="inbox">
      <header className="inbox__head">
        <h1 className="inbox__title">{t('shell.page.inbox')}</h1>
        <Tabs items={tabs} value={filter.group} onChange={(group) => setInboxFilter({ ...filter, group })} variant="segmented" label={t('inbox.filter')} />
        {filter.planId !== undefined && (
          <Chip tone="info">
            {tree.flatMap((p) => p.plans).find((pl) => pl.jobId === filter.planId)?.name ?? t('inbox.onePlan')}
            <button type="button" className="inbox__chip-x" aria-label={t('inbox.allPlans')} onClick={() => setInboxFilter({ group: filter.group })}>
              ×
            </button>
          </Chip>
        )}
      </header>
      <div className="inbox__cols">
        <section className="inbox__col inbox__col--needs" aria-label={t('wall.filter.needs')}>
          <h2 className="inbox__h">
            {t('wall.filter.needs')} <span className="inbox__count">{shown.length}</span>
          </h2>
          {shown.length === 0 && (
            <EmptyState icon={CheckCircle2}>{filter.group === 'handled' ? t('inbox.showingHandled') : t('inbox.nothingNeeds')}</EmptyState>
          )}
          <ul className="inbox__list">
            {shown.map((c) => (
              <li key={c.key}>
                <NeedCardView c={c} nowMs={nowMs} door={doorOf(c.jobId)} ui={ui} t={t} />
              </li>
            ))}
          </ul>
        </section>
        <section className="inbox__col inbox__col--handled" aria-label={t('inbox.handled')}>
          <h2 className="inbox__h">{t('inbox.handled')}</h2>
          {handled.length === 0 && <EmptyState icon={InboxIcon}>{t('inbox.handledEmpty')}</EmptyState>}
          <ul className="inbox__feed">
            {handled.map((l) => (
              <li key={l.id} className={`inbox__line inbox__line--${l.tone}`}>
                <button
                  type="button"
                  className="inbox__line-row"
                  disabled={l.sessionId === undefined}
                  title={l.sessionId ? t('inbox.openConsole') : undefined}
                  onClick={() => l.sessionId && openConsole(l.sessionId)}
                >
                  <span className="inbox__time">{timeOf(l.at)}</span>
                  <span className="inbox__text">{l.text}</span>
                </button>
                {l.who && <div className="inbox__who">{l.who}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

const KIND_WORD: Record<NeedCard['kind'], [MessageKey, 'info' | 'warn' | 'danger']> = {
  approval: ['inbox.kind.approval', 'info'],
  question: ['inbox.kind.question', 'warn'],
  gate: ['inbox.kind.question', 'warn'],
  escalation: ['inbox.kind.decision', 'danger'],
  permission: ['inbox.kind.permission', 'warn'],
  waiting: ['inbox.kind.waiting', 'warn']
}

export function NeedCardView({
  c,
  nowMs,
  door,
  ui,
  t
}: {
  c: NeedCard
  nowMs: number
  door: ReturnType<typeof localDoor>
  ui: ActionUi
  t: ReturnType<typeof useI18n>['t']
}): React.JSX.Element {
  const [word, tone] = KIND_WORD[c.kind]
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const startAfter = (otherJobId: string): Promise<unknown> =>
    door.command('jobs-set', { id: c.jobId, after: otherJobId }).then((r) => {
      if (r.status >= 400) ui.error(replyNote(r, ui.t, t('inbox.queueFailed')))
    })
  // Overlapping plans, once each, for "Start after"
  const others = [...new Map((c.overlaps ?? []).map((o) => [o.otherJobId, o.otherPlanName])).entries()]

  return (
    <Card tone={c.kind === 'escalation' ? 'danger' : 'need'} className="inbox__card">
      <div className="inbox__card-head">
        <Chip tone={tone}>{t(word)}</Chip>
        <span className="inbox__where">{whereOf(c.projectName, c.planName, c.taskTitle)}</span>
        <span className="inbox__age">{ageOf(c.at, nowMs, t)}</span>
      </div>

      {c.q && (
        <>
          <QuestionAnswer
            q={{ id: c.q.id, source: c.q.source ?? 'ask', taskId: c.q.taskId, question: c.q.question, ...(c.q.options ? { options: c.q.options } : {}), ...(c.q.freeText === false ? { freeText: false as const } : {}) }}
            onAnswer={async (id, answer) => {
              const r = await door.command('questions-answer', { id, answer })
              return r.status === 200 ? null : replyNote(r, t as never, (r.body as { error?: string } | null)?.error ?? t('plan.question.failed'))
            }}
          />
          <div className="inbox__actions">
            {c.sessionId && (
              <Button size="sm" icon={<TerminalSquare size={14} />} onClick={() => openConsole(c.sessionId!)}>
                {t('inbox.openConsole')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openPlan(c.jobId)}>
              {t('inbox.openPlan')}
            </Button>
          </div>
        </>
      )}

      {(c.kind === 'permission' || c.kind === 'waiting') && (
        <>
          <p className="inbox__body">{c.kind === 'permission' ? t('inbox.body.permission') : t('inbox.body.waiting')}</p>
          <div className="inbox__actions">
            <Button size="sm" variant="primary" icon={<TerminalSquare size={14} />} onClick={() => openConsole(c.sessionId!)}>
              {t('inbox.answerInConsole')}
            </Button>
          </div>
        </>
      )}

      {c.kind === 'approval' && (
        <>
          {c.overlaps && c.overlaps.length > 0 && (
            <div className="inbox__warn" role="note">
              {c.overlaps.map((o) => (
                <p key={`${o.taskId}:${o.otherTaskTitle}`}>{t(o.line.key, o.line.params)}</p>
              ))}
              <div className="inbox__actions">
                {others
                  .filter(([, name]) => name !== c.waitsOn)
                  .map(([id, name]) => (
                    <Button key={id} size="sm" disabled={busy} onClick={() => void run(() => startAfter(id))}>
                      {t('inbox.startAfter', { plan: name })}
                    </Button>
                  ))}
                {/* No command moves a Task between plans yet: this opens the Tasks, where it can be changed */}
                {c.overlaps.map((o) => (
                  <Button key={`m:${o.taskId}:${o.otherJobId}`} size="sm" variant="ghost" onClick={() => openPlan(c.jobId, 'files')}>
                    {t('inbox.move', { task: o.taskTitle, plan: o.otherPlanName })}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="inbox__actions">
            <Button size="sm" onClick={() => openPlan(c.jobId, 'overview')}>
              {t('inbox.reviewPlan')}
            </Button>
            {c.sessionId && (
              <Button size="sm" onClick={() => openConsole(c.sessionId!)}>
                {t('pages.plan.talk')}
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => approvePlan(door, c.jobId, c.planName, ui))}>
              {c.waitsOn ? t('inbox.approveWaits', { plan: c.planName }) : t('inbox.approve')}
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
