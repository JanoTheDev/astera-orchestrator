// DESIGN-W13 §6: the bottom panel's Needs you tab (the former Inbox page). One compact row per decision: kind icon and
// word, "project › plan · task", age, and its one action (Approve / Answer / Open). A click on the row expands it to
// the question or gate with its answers inline. "Handled for you" lives in the Activity tab. A permission prompt stays
// in the real CLI (CONTEXT rule 6), so its row only opens the console.
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { localDoor, replyNote } from '../../lib/orchDoor'
import { Button, Chip, Icon, IconButton, Menu, menuPointOf, Tabs, type IconName } from '../ui'
import { openConsole, openPlan } from '../shell/navigation'
import { QuestionAnswer } from '../plan/QuestionAnswer'
import { setInboxFilter, useInboxRequest, type OpenTarget, openTargetOf, revealTask } from './inboxNav'
import { markRead, markUnread, toggleAllProjects, useBellState } from './bellStore'
import { itemMenuOf, needTextOf } from './itemMenu'
import { BELL_ACTION_LABEL, bellActionOf } from './bellView'
import { NEED_WORD, ageOf, filterNeeds, whereOf, type NeedCard, type NeedKind } from './inboxView'
import { useNeedsYou, type NeedsYouScope } from './useNeedsYou'
import './inbox.css'

const KIND_ICON: Record<NeedKind, IconName> = { approval: 'listTree', command: 'terminal', question: 'message', gate: 'message', escalation: 'warning', permission: 'terminal', waiting: 'waiting' }

/** Goes where an Open leads. A Task opens the plan at its section (`task-<id>`): the Task's step opens and its row
 *  expands (PlanPage's anchor), then revealTask centres the card (a card in a folded step is not drawn until then). */
export function goTo(target: OpenTarget): void {
  if (target.kind === 'console') return openConsole(target.sessionId)
  openPlan(target.jobId, target.taskId !== undefined ? `task-${target.taskId}` : undefined)
  if (target.taskId !== undefined) revealTask(target.taskId)
}

export function InboxPage({ scope, ui }: { scope: NeedsYouScope; /** The app's Job action ui (confirm dialogs, toasts), for Approve. */ ui: ActionUi }): React.JSX.Element {
  const { t } = useI18n()
  const { filter } = useInboxRequest()
  const { needs, pathOfJob, many, allProjects } = useNeedsYou(scope, true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const shown = useMemo(() => filterNeeds(needs, filter), [needs, filter])
  const planName = filter.planId !== undefined ? (needs.find((c) => c.jobId === filter.planId)?.planName ?? t('inbox.onePlan')) : null
  const doorOf = (jobId: string) => localDoor(window.api, pathOfJob.get(jobId) ?? scope.scopedTree[0]?.path ?? '')

  return (
    <div className="needs">
      {(many || planName !== null) && (
        <div className="needs__bar">
          {many && (
            <Tabs
              items={[
                { id: 'project', label: t('inbox.scope.project') },
                { id: 'all', label: t('bell.allProjects') }
              ]}
              value={allProjects ? 'all' : 'project'}
              onChange={(id) => (id === 'all') !== allProjects && toggleAllProjects()}
              variant="segmented"
              label={t('inbox.filter')}
            />
          )}
          {planName !== null && (
            <Chip tone="info" className="inbox__plan-chip">
              {planName}
              <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('inbox.allPlans')} onClick={() => setInboxFilter({ group: filter.group })} />
            </Chip>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="needs__none">{t('inbox.empty.line')}</p>
      ) : (
        <ul className="needs__list">
          {shown.map((c) => (
            <li key={c.key}>
              <NeedCardView c={c} nowMs={nowMs} door={doorOf(c.jobId)} ui={ui} t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function NeedCardView({
  c,
  nowMs,
  door,
  ui,
  t,
  open: startOpen = false
}: {
  c: NeedCard
  nowMs: number
  door: ReturnType<typeof localDoor>
  ui: ActionUi
  t: ReturnType<typeof useI18n>['t']
  /** Starts expanded (the markup tests). */
  open?: boolean
}): React.JSX.Element {
  const [word, tone] = NEED_WORD[c.kind]
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(startOpen)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const isRead = useBellState().read.has(c.key)
  const action = bellActionOf(c)
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
  // T4: the owner's answer to a worker's request runs the command (or not); a command that failed says why
  const answerCommand = (answer: 'approve' | 'deny'): Promise<unknown> =>
    door.command('questions-answer', { id: c.q!.id, answer }).then((r) => {
      const ran = (r.body as { result?: { status: number; body: unknown } } | null)?.result
      if (r.status >= 400) ui.error(replyNote(r, ui.t, t('inbox.commandFailed')))
      else if (ran && ran.status >= 400) ui.error(t('inbox.commandRanFailed', { error: (ran.body as { error?: string } | null)?.error ?? String(ran.status) }))
    })
  // Overlapping plans, once each, for "Start after"
  const others = [...new Map((c.overlaps ?? []).map((o) => [o.otherJobId, o.otherPlanName])).entries()]

  const target = openTargetOf(c)
  const menuItems = itemMenuOf(
    { key: c.key, target, sessionId: c.sessionId, text: needTextOf(c, t) },
    isRead,
    { open: goTo, console: openConsole, setRead: (key, r) => (r ? markRead(key) : markUnread(key)), copy: (text) => window.api.clipboard.writeText(text) },
    t
  )

  return (
    <div className={`needs-row${open ? ' needs-row--open' : ''}${isRead ? ' needs-row--read' : ''}${c.kind === 'escalation' ? ' needs-row--danger' : ''}`}>
      <div
        className="needs-row__head"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuAt(menuPointOf(e))
        }}
      >
        <Button variant="ghost" size="sm" className="needs-row__toggle" aria-expanded={open} icon={<Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />} onClick={() => setOpen((v) => !v)}>
          <Icon name={KIND_ICON[c.kind]} size={14} className={`needs-row__kind needs-row__kind--${tone}`} />
          <span className="needs-row__word">{t(word)}</span>
          <span className="inbox__where">{whereOf(c.projectName, c.planName, c.taskTitle)}</span>
          <span className="inbox__age">{ageOf(c.at, nowMs, t)}</span>
          {isRead && <Icon name="check" size={14} className="needs-row__read" label={t('inbox.item.readCue')} />}
        </Button>
        <Button
          size="sm"
          variant={action === 'approve' ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={() => (action === 'approve' ? void run(() => approvePlan(door, c.jobId, c.planName, ui)) : action === 'answer' ? setOpen(true) : goTo(openTargetOf(c)))}
        >
          {t(BELL_ACTION_LABEL[action])}
        </Button>
      </div>
      {menuAt && <Menu at={menuAt} items={menuItems} onClose={() => setMenuAt(null)} label={t('bell.needsYou')} />}
      {open && <div className="needs-row__body">
      {c.kind === 'command' && c.q && (
        <>
          <p className="inbox__body">{t('inbox.body.command', { task: c.taskTitle ?? c.q.taskId })}</p>
          <pre className="inbox__command">
            <code>{c.q.command ?? c.q.question}</code>
          </pre>
          <div className="inbox__actions">
            <Button size="sm" variant="ghost" onClick={() => goTo(openTargetOf(c))}>
              {t('inbox.openPlan')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void run(() => answerCommand('deny'))}>
              {t('inbox.deny')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => answerCommand('approve'))}>
              {t('inbox.approve')}
            </Button>
          </div>
        </>
      )}

      {c.q && c.kind !== 'command' && (
        <>
          <QuestionAnswer
            q={{ id: c.q.id, source: c.q.source === 'escalation' ? 'escalation' : 'ask', taskId: c.q.taskId, question: c.q.question, ...(c.q.options ? { options: c.q.options } : {}), ...(c.q.freeText === false ? { freeText: false as const } : {}) }}
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
            <Button size="sm" variant="ghost" onClick={() => goTo(openTargetOf(c))}>
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
      </div>}
    </div>
  )
}
