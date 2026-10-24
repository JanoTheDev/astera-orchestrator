// The lower pane of the plan page (moved out of pages/PlanPage.tsx): the event journal, filtered by the picked Task,
// or in its place the new-Task form, the ask form or the Gate answer.
import type { JobEvent, RunDetail as RunDetailData } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskLinkChips } from '../TaskLinkChips'
import { GateAnswer } from '../GateAnswer'
import { STATE_KEY, TaskGlyph, TaskIcon } from '../JobIcons'
import { JournalBusy, JournalOlder } from '../RunDetailJournal'
import { Button, Field, Icon, IconButton } from '../ui'
import '../formDialogs.css'
import { CALLS_FOR_A_PERSON, KIND_LABEL, MSG_LABEL, RECOVERY_LABEL, timeOf } from './planPage'
import type { PlanPageState } from './usePlanPage'

export function PlanJournal({
  p,
  detail,
  canOpenSession,
  onOpenSession,
  onShowOlderJournal
}: {
  p: PlanPageState
  detail: RunDetailData | null
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  onShowOlderJournal: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const {
    answering, answer, setAnswer, asking, question, setQuestion, busy, gateError,
    accounts, tasks, selectedTask, setSelected, events, open, toggle,
    resolveGate, cancelAnswer, askQuestion, cancelAsk
  } = p
  const keyOf = (e: JobEvent): string => `${e.kind}:${e.sourceId}`
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
    <div className="detail-events">
      {answering !== null ? (
        (() => {
          // 답할 Gate 는 스냅숏에서 다시 찾는다 — 폼을 연 뒤에 그 Gate 가 풀렸을 수 있고
          // (코디네이터나 CLI 가 답할 수 있다), 그때 열어 둔 id 로 보내면 이미 끝난 것을
          // 다시 푼다. 사라졌으면 폼을 그리지 않고 원래 화면으로 돌아간다.
          const gate = tasks.find((tk) => tk.id === answering)?.gate
          if (!gate) return <></>
          return (
            <GateAnswer
              gate={gate}
              answer={answer}
              busy={busy !== null}
              error={gateError}
              onAnswer={setAnswer}
              onResolve={(resolution) => void resolveGate(gate.id, resolution)}
              onCancel={cancelAnswer}
            />
          )
        })()
      ) : asking !== null ? (
        <>
          {/* .detail-filter/.detail-clear 를 NewTaskModal 과 같이 빌린다 — 무엇을 하고 있는지
              보여 주던 자리를 그대로 쓴다 */}
          <div className="detail-filter">
            <b>{t('jobs.node.gate')}</b>
            <IconButton
              className="detail-clear"
              size="sm"
              icon={<Icon name="close" size={14} />}
              label={t('common.cancel')}
              onClick={cancelAsk}
            />
          </div>
          <div className="detail-task-fields">
            <Field
              kind="textarea"
              label={t('jobs.node.gateQuestion')}
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
            {/* NewTaskModal 과 같은 자리 — 이 폼에만 있는 실패는 이 폼 안에서 죽는다 */}
            {gateError && (
              <p className="ui-field__error" role="alert">
                {gateError}
              </p>
            )}
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={cancelAsk} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null || !question.trim()}
              onClick={() => void askQuestion()}
            >
              {t('jobs.node.gate')}
            </Button>
          </div>
        </>
      ) : (
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
              <IconButton
                className="detail-clear"
                size="sm"
                icon={<Icon name="close" size={14} />}
                label={t('jobs.detail.clearFilter')}
                onClick={() => setSelected(null)}
              />
            </div>
          )}
          {/* T8: the picked Task's completion checks and changes moved into its expanded row (TaskBoard) */}
          <JournalBusy journal={detail?.journal} />
          <div className="detail-list">
            {/* 목록은 오래된 것이 위다 — 더 오래된 저널 줄을 부르는 자리도 맨 위다 */}
            <JournalOlder journal={detail?.journal} onShowOlder={onShowOlderJournal} />
            {events !== null && shown.length === 0 && (
              <p className="ui-field__hint">{t('jobs.timeline.empty')}</p>
            )}
            {shown.map((e) => {
              const key = keyOf(e)
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
                    onClick={e.body ? () => toggle(key) : undefined}
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
                        {/* The row click is mouse-only; this is its keyboard twin */}
                        {e.body && (
                          <IconButton
                            className="plan-journal-toggle"
                            size="sm"
                            icon={<Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />}
                            label={t(expanded ? 'plan.journal.collapse' : 'plan.journal.expand')}
                            aria-expanded={expanded}
                            onClick={(ev) => {
                              ev.stopPropagation() // the row click toggles too
                              toggle(key)
                            }}
                          />
                        )}
                        {sessionId && (
                          <IconButton
                            className="detail-jump"
                            size="sm"
                            icon={<Icon name="open" size={14} />}
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
      )}
    </div>
  )
}
