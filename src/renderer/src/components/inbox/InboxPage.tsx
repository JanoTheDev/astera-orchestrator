// W9-D Inbox page, restyled for W11 (DESIGN-W11 §7, §9 "Inbox"): PageHeader with the group filter, then two columns.
// Left, "Needs you": plan approvals, questions, escalations, Gates and permission waits, oldest first, each answered
// here. Right, "Handled for you": the W3-A feed, one line per event grouped by day.
// A permission prompt stays in the real CLI (CONTEXT rule 6), so its card only opens the console.
import { useEffect, useMemo, useState } from 'react'
import type { Account } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { localDoor, replyNote } from '../../lib/orchDoor'
import { Button, Card, Chip, EmptyState, ICONS, Icon, IconButton, PageHeader, Tabs, type IconName, type TabItem } from '../ui'
import { openConsole, openPlan } from '../shell/navigation'
import { QuestionAnswer } from '../plan/QuestionAnswer'
import type { WorkspaceData, WorkspaceProject } from '../../state/workspaceTree'
import type { Tone } from '../activity/activityView'
import { setInboxFilter, useInboxRequest } from './inboxNav'
import { NEED_WORD, ageOf, byDay, filterNeeds, handledOf, whereOf, type HandledLine, type InboxGroup, type NeedCard } from './inboxView'
import { useInbox } from './useInbox'
import './inbox.css'

const GROUPS: Array<[InboxGroup, MessageKey]> = [
  ['all', 'wall.filter.all'],
  ['approvals', 'inbox.group.approvals'],
  ['questions', 'inbox.group.questions'],
  ['permissions', 'inbox.group.permissions'],
  ['handled', 'inbox.group.handled']
]

/** Status needs a second cue (DESIGN-W11 §2): each feed line leads with its tone's icon. */
const TONE_ICON: Record<Tone, IconName> = { ok: 'done', bad: 'error', warn: 'warning', info: 'pending' }

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
  const days = useMemo(() => byDay(handled, nowMs, t), [handled, nowMs, t])
  const tabs: TabItem<InboxGroup>[] = GROUPS.map(([id, key]) => {
    const n = id === 'handled' ? handled.length : filterNeeds(needs, { ...filter, group: id }).length
    return { id, label: t(key), ...(n > 0 ? { count: n } : {}) }
  })
  const planName = filter.planId !== undefined ? (tree.flatMap((p) => p.plans).find((pl) => pl.jobId === filter.planId)?.name ?? t('inbox.onePlan')) : null

  const doorOf = (jobId: string) => localDoor(window.api, pathOfJob.get(jobId) ?? tree[0]?.path ?? '')

  return (
    <div className="inbox">
      <PageHeader
        title={t('shell.page.inbox')}
        subtitle={needs.length > 0 ? t('inbox.needsCount', { n: needs.length }) : undefined}
        filters={
          <>
            <Tabs items={tabs} value={filter.group} onChange={(group) => setInboxFilter({ ...filter, group })} variant="segmented" label={t('inbox.filter')} />
            {planName !== null && (
              <Chip tone="info" className="inbox__plan-chip">
                {planName}
                <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('inbox.allPlans')} onClick={() => setInboxFilter({ group: filter.group })} />
              </Chip>
            )}
          </>
        }
      />
      {shown.length === 0 && handled.length === 0 ? (
        <EmptyState icon={ICONS.inbox} title={t('inbox.empty.title')}>
          {t('inbox.empty.text')}
        </EmptyState>
      ) : (
        <div className={`inbox__cols${shown.length === 0 ? ' inbox__cols--quiet' : ''}`}>
          <section className="inbox__col inbox__col--needs" aria-label={t('wall.filter.needs')}>
            <h2 className="inbox__h">
              {t('wall.filter.needs')}
              {shown.length > 0 && <span className="inbox__count">{shown.length}</span>}
            </h2>
            {shown.length === 0 ? (
              <p className="inbox__none">
                <Icon name="done" size={14} />
                {filter.group === 'handled' ? t('inbox.showingHandled') : t('inbox.nothingNeeds')}
              </p>
            ) : (
              <ul className="inbox__list">
                {shown.map((c) => (
                  <li key={c.key}>
                    <NeedCardView c={c} nowMs={nowMs} door={doorOf(c.jobId)} ui={ui} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="inbox__col inbox__col--handled" aria-label={t('inbox.handled')}>
            <h2 className="inbox__h">{t('inbox.handled')}</h2>
            {handled.length === 0 && <p className="inbox__none">{t('inbox.handledEmpty')}</p>}
            {days.map((d) => (
              <div key={d.day} className="inbox__day">
                <h3 className="inbox__day-h">{d.label}</h3>
                <ul className="inbox__feed">
                  {d.lines.map((l) => (
                    <HandledRow key={l.id} l={l} t={t} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}

/** One handled event: icon, what happened, its plan, the time. The full text and who did it show in the row's tooltip. */
function HandledRow({ l, t }: { l: HandledLine; t: ReturnType<typeof useI18n>['t'] }): React.JSX.Element {
  const title = [l.text, l.who, l.sessionId ? t('inbox.openConsole') : ''].filter(Boolean).join('\n')
  return (
    <li className={`inbox__line inbox__line--${l.tone}`}>
      <Button variant="ghost" className="inbox__line-row" disabled={l.sessionId === undefined} title={title} icon={<Icon name={TONE_ICON[l.tone]} size={14} className="inbox__tone" />} onClick={() => l.sessionId && openConsole(l.sessionId)}>
        <span className="inbox__text">{l.text}</span>
        {l.plan && <span className="inbox__plan">{l.plan}</span>}
        <span className="inbox__time">{timeOf(l.at)}</span>
      </Button>
    </li>
  )
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
  const [word, tone] = NEED_WORD[c.kind]
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
              <Button size="sm" variant="ghost" icon={<Icon name="terminal" size={14} />} onClick={() => openConsole(c.sessionId!)}>
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
            <Button size="sm" variant="primary" icon={<Icon name="terminal" size={14} />} onClick={() => openConsole(c.sessionId!)}>
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
            <Button size="sm" variant="ghost" onClick={() => openPlan(c.jobId, 'overview')}>
              {t('inbox.reviewPlan')}
            </Button>
            {c.sessionId && (
              <Button size="sm" variant="ghost" onClick={() => openConsole(c.sessionId!)}>
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
