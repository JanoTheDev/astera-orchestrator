// The plan's log: the picked Task's filter line, what blocks it and what it changed, then the journal's events (oldest
// first). Moved out of pages/PlanPage.tsx; the events and their order are core's (orchestration/timeline.ts).
import type { Account, JobEvent, JobTask, MessageType, RunDetail as RunDetailData } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { TaskLinkChips } from '../TaskLinkChips' // W2-D GitHub links
import { ChangedFilesBlock } from '../ChangedFilesBlock'
import { CompletionBlock } from '../CompletionBlock'
import { STATE_KEY, TaskGlyph, TaskIcon } from '../JobIcons'
import { JournalBusy, JournalOlder } from '../RunDetailJournal'
import { ArrowUpRight, X } from 'lucide-react'
import { IconButton } from '../ui'

/** 종류 배지의 문구. message 는 messageType 이 정한다.
 *  heartbeat 과 decision_gate 는 timeline.ts 의 SKIP 이 걸러 지금은 도달하지 않지만, 맵을
 *  온전하게 두면 그 규칙이 바뀌어도 문구가 없는 배지가 나오지 않는다. */
const MSG_LABEL: Record<MessageType, MessageKey> = {
  status: 'jobs.event.status',
  worker_done: 'jobs.event.workerDone',
  question: 'jobs.event.question',
  escalation: 'jobs.event.escalation',
  heartbeat: 'jobs.event.heartbeat',
  decision_gate: 'jobs.event.decisionGate'
}

const KIND_LABEL: Record<Exclude<JobEvent['kind'], 'message'>, MessageKey> = {
  'run-created': 'jobs.event.runCreated',
  'task-created': 'jobs.event.taskCreated',
  'dispatch-started': 'jobs.event.dispatchStarted',
  'gate-opened': 'jobs.event.gateOpened',
  'gate-resolved': 'jobs.event.gateResolved',
  'limit-hit': 'jobs.event.limitHit',
  resumed: 'jobs.event.resumed',
  'runtime-lost': 'jobs.event.runtimeLost',
  recovery: 'jobs.event.recovery'
}

/** A recovery line's summary is the strategy as the journal stored it (core/continuity/timelineRows.ts
 *  carries the row through verbatim) — the journal is the source of truth, so the data stays raw and
 *  the wording happens here. A strategy this map does not know falls back to the raw string: a new
 *  strategy showing as `resume-native` reads better than showing as nothing. */
const RECOVERY_LABEL: Record<string, MessageKey> = {
  'resume-native': 'jobs.recovery.resumeNative',
  redispatch: 'jobs.recovery.redispatch',
  recheck: 'jobs.recovery.recheck',
  'smart-resume': 'jobs.recovery.smartResume',
  review: 'jobs.recovery.review'
}

/** 사람을 부르는 메시지. 이 셋만 이벤트 표식으로 blocked 글리프(사람을 기다린다)를 빌린다 —
 *  나머지는 기록 한 줄일 뿐이다. */
const CALLS_FOR_A_PERSON: ReadonlySet<MessageType> = new Set<MessageType>([
  'question',
  'escalation',
  'decision_gate'
])


/** 시각의 표시 형태 — 날짜는 버리고 시:분:초만 남긴다. 한 Run 이 여러 날에 걸치는 경우가 드물고,
 *  좁은 칸에서 날짜는 전부 같은 값이라 자리만 먹는다.
 *
 *  **문자열을 자르지 않는다.** `JobEvent.at` 은 ISO-Z(UTC)이므로 `at.slice(11, 19)` 는 UTC 를
 *  그린다 — KST 사용자에게는 아홉 시간 이른 시각이고, 워커가 방금 한 일이 오늘 아침에 일어난 것처럼
 *  보인다. Date 로 파싱해 지역 시각으로 옮기는 것이 이 값의 유일한 올바른 표시다. 정렬은 core 의
 *  ISO 문자열이 하므로(timeline.ts) 표시를 바꾸는 것이 순서에 영향을 주지 않는다.
 *
 *  형식은 Intl 이 아니라 손으로 맞춘다 — 로케일마다 12시간제와 구분자가 달라지면 한 화면에서 눈으로
 *  순서를 따라가기 어렵고, 이 칸은 tabular-nums 로 자리를 맞춰 둔 고정폭 칸이다. */
const timeOf = (at: string): string => {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const eventKeyOf = (e: JobEvent): string => `${e.kind}:${e.sourceId}`

export function PlanJournal({
  detail,
  selectedTask,
  accounts,
  onClearFilter,
  projectPath,
  runId,
  runtimeId,
  door,
  canOpenSession,
  onOpenSession,
  onShowOlderJournal,
  open,
  onToggle
}: {
  detail: RunDetailData | null
  /** The Task the graph or board picked: the events are filtered to it. */
  selectedTask: JobTask | undefined
  accounts: Account[] | null
  onClearFilter: () => void
  projectPath: string
  runId: string
  runtimeId?: string
  door: OrchDoor
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  onShowOlderJournal: () => void
  /** The expanded events, by eventKeyOf. Held by the page so a form opening over the log does not fold them. */
  open: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const events = detail?.events ?? null
  const shown = selectedTask
    ? (events ?? []).filter((e) => e.taskId === selectedTask.id)
    : (events ?? [])
  const hidden = (events?.length ?? 0) - shown.length

  /** 이벤트 앞의 표식. **Task 상태의 글리프를 빌려 쓴다** — 사람을 부르는 사건은 사이드바에서
   *  blocked 인 Task 가 쓰는 바로 그 모양이다. 나머지는 중립적인 점이고, 워커가 뜬 것만 열린 고리로
   *  구별한다: 그 줄에서만 세션 탭으로 갈 수 있다. */
  const markOf = (e: JobEvent): React.JSX.Element => {
    const callsForAPerson =
      e.kind === 'gate-opened' ||
      (e.kind === 'message' && CALLS_FOR_A_PERSON.has(e.messageType ?? 'status'))
    if (callsForAPerson) return <TaskIcon status="blocked" label={t(STATE_KEY.blocked)} />
    if (e.kind === 'dispatch-started') return <span className="detail-ring" />
    return <span className="detail-dot" />
  }

  return (
    <>
      {selectedTask && (
        <div className="detail-filter">
          <TaskGlyph task={selectedTask} />
          <b>{selectedTask.title}</b>
          {/* 지정된 계정. **지정이 있을 때만 그린다** — 없는 것이 보통이라 "기본 계정"을
              늘 적으면 이 줄이 그 낱말로 채워지고, 정작 지정된 Task 가 눈에 안 띈다.
              그래서 이 칩이 있다는 것 자체가 "이 Task 는 계정이 못박혀 있다"는 뜻이다.
              이름을 못 찾으면 id 를 적는다 — 지워진 계정을 가리키는 지정이고, 그것을
              감추면 왜 이 Task 가 Gate 로 가는지 화면에 남지 않는다.
              여럿이면 적은 순서대로 ' → ' 로 잇는다 — 그것이 한도에 걸렸을 때 갈아탈
              순서이고, 세션 탭의 롤링 툴팁이 같은 모양으로 그 순서를 적는다. */}
          {selectedTask.accountIds !== undefined && (
            <span
              className="detail-chip"
              title={t('jobs.task.accountHint')}
            >
              {selectedTask.accountIds
                .map((id) => accounts?.find((a) => a.id === id)?.label ?? id)
                .join(' → ')}
            </span>
          )}
          {/* W2-D GitHub links */}
          <TaskLinkChips links={selectedTask.links} />
          <IconButton className="plan-clear" size="sm" icon={<X size={14} />} label={t('jobs.detail.clearFilter')} onClick={onClearFilter} />
        </div>
      )}
      {/* 고른 Task 의 완료 상세 — 왜 못 넘었는가(설계 §2). 필터 줄 바로 아래, 이벤트
          목록 위다: 이벤트는 "무슨 일이 있었나" 이고 이것은 "지금 무엇이 막고 있나" 라,
          찾는 사람이 스크롤하지 않고 만나야 하는 쪽이 이것이다. */}
      {selectedTask && (
        <CompletionBlock projectPath={projectPath} runId={runId} taskId={selectedTask.id} runtimeId={runtimeId} />
      )}
      {/* What the Task, or with none chosen the whole Run, changed (Phase 10): from git where the Run lives,
          beside what its workers reported. */}
      {/* W9-C: the whole plan's changes are the Changes section; the picked Task's stay here */}
      {selectedTask && <ChangedFilesBlock door={door} runId={runId} taskId={selectedTask.id} />}
      <JournalBusy journal={detail?.journal} />
      <div className="detail-list">
        {/* 목록은 오래된 것이 위다 — 더 오래된 저널 줄을 부르는 자리도 맨 위다 */}
        <JournalOlder journal={detail?.journal} onShowOlder={onShowOlderJournal} />
        {events !== null && shown.length === 0 && (
          <p className="modal-hint">{t('jobs.timeline.empty')}</p>
        )}
        {shown.map((e) => {
          const key = eventKeyOf(e)
          const expanded = open.has(key)
          const sessionId =
            e.sessionId && canOpenSession(e.sessionId) ? e.sessionId : undefined
          // dispatch-started 의 요약은 provider 이름 그대로다(timeline.ts) — 배지가 이미
          // 그것을 적고 있으므로 아래 줄을 비운다
          // limit-hit·resumed 의 요약은 원시 계정 id 다(timeline.ts — core 는 계정 라벨을
          // 모르므로 id 만 실었다). 지워진 계정이면 accounts 에 없고, 그때 id 를 그대로
          // 그리면 uuid 가 보인다 — 라벨을 못 찾으면 아무것도 그리지 않는다(uuid 보다 낫다).
          // A recovery summary is a strategy name; RECOVERY_LABEL above turns it into words.
          const recoveryKey = e.kind === 'recovery' ? RECOVERY_LABEL[e.summary] : undefined
          const summary =
            e.kind === 'dispatch-started'
              ? ''
              : e.kind === 'limit-hit' || e.kind === 'resumed'
                ? (accounts?.find((a) => a.id === e.summary)?.label ?? '')
                : recoveryKey
                  ? t(recoveryKey)
                  : e.summary
          return (
            <div key={key} className="detail-event">
              <div
                className={`detail-ev${e.body ? ' has-body' : ''}`}
                onClick={e.body ? () => onToggle(key) : undefined}
              >
                <span className="detail-at">{timeOf(e.at)}</span>
                <span className="detail-mark">{markOf(e)}</span>
                <div className="detail-ev-main">
                  <div className="detail-eh">
                    <b>
                      {e.kind === 'message'
                        ? t(MSG_LABEL[e.messageType ?? 'status'])
                        : t(KIND_LABEL[e.kind])}
                    </b>
                    {e.provider && (
                      <span className="detail-chip provider">{e.provider}</span>
                    )}
                    {e.retry && (
                      <span className="detail-chip retry">{t('jobs.timeline.retry')}</span>
                    )}
                    {e.review && (
                      <span className="detail-chip review">{t('jobs.event.review')}</span>
                    )}
                    {/* 설계 §3(V2): 왜 다시 띄웠는지. 검사가 실패해서인지 검토가 지적해서인지를
                        말하지 않으면 이 줄은 앞의 구현 줄과 구별되지 않는다 */}
                    {e.repair && (
                      <span className="detail-chip repair">
                        {t(
                          e.repair === 'check-failure'
                            ? 'jobs.event.repairCheck'
                            : 'jobs.event.repairReview'
                        )}
                      </span>
                    )}
                    {/* 결과가 실린 메시지에만 나온다. **이 줄이 워커가 실패를 보고했다는
                        사실의 유일한 기록이다** — applyWorkerDone 은 두 번째 메시지를
                        만들지 않고, 타임라인에는 Task 상태 변화 이벤트가 없다 */}
                    {e.outcome && (
                      <span className={`detail-outcome o-${e.outcome}`}>
                        {t(
                          e.outcome === 'succeeded'
                            ? 'jobs.event.succeeded'
                            : 'jobs.event.outcomeFailed'
                        )}
                      </span>
                    )}
                    {/* 어느 Task 의 일인가. 걸러 놓은 동안에는 위의 필터 줄이 이미 같은
                        말을 하고 있어서 적지 않는다 */}
                    {!selectedTask && e.taskTitle && (
                      <span className="detail-ev-task" title={e.taskTitle}>
                        {e.taskTitle}
                      </span>
                    )}
                    {sessionId && (
                      <IconButton
                        className="plan-jump"
                        size="sm"
                        icon={<ArrowUpRight size={14} />}
                        label={t('jobs.timeline.openSession')}
                        onClick={(ev) => {
                          ev.stopPropagation() // 펼치기와 겹치지 않게 한다
                          onOpenSession(sessionId)
                        }}
                      />
                    )}
                  </div>
                  {summary && (
                    <div className="detail-summary" title={summary}>
                      {summary}
                    </div>
                  )}
                </div>
              </div>
              {expanded && e.body && <pre className="detail-ev-body">{e.body}</pre>}
            </div>
          )
        })}
      </div>
      {/* 가려진 개수. 이것이 없으면 걸러 놓은 화면과 이벤트가 원래 적은 Run 이 같아
          보인다 */}
      {selectedTask && hidden > 0 && (
        <p className="detail-hidden">{t('jobs.detail.hidden', { count: hidden })}</p>
      )}
    </>
  )
}
