// The form that takes the log's place while a Task is being added, asked about or answered (usePlanActions'
// authoringOpen). Moved out of pages/PlanPage.tsx; the graph stays visible above it.
import type { JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { checkChoicesOf } from '../checkText'
import { GateAnswer } from '../GateAnswer'
import { NewTaskModal } from '../NewTaskModal'
import { X } from 'lucide-react'
import { Button, IconButton, Textarea } from '../ui'
import type { PlanActions } from './usePlanActions'

export function PlanTaskForm({ actions: a, door, runId, tasks }: { actions: PlanActions; door: OrchDoor; runId: string; tasks: JobTask[] }): React.JSX.Element {
  const { t } = useI18n()
  return a.authoring ? (
    // **계정을 provider 로 걸러 보내지 않는다** — 이 폼에서 고른 첫 계정이 provider 를
    // 정하므로(Task.accountIds), 걸러 보낼 기준이 이 시점에 없다. 두 번째 칸부터 첫
    // 계정의 provider 로 좁히는 일은 폼 안에서 한다.
    <NewTaskModal
      door={door}
      runId={runId}
      tasks={tasks}
      accounts={a.accounts}
      runConfigs={a.runConfigs === null ? null : checkChoicesOf(a.runConfigs, a.checkPlugins, t)}
      onClose={() => a.setAuthoring(false)}
      onCreated={() => a.setAuthoring(false)}
    />
  ) : a.answering !== null ? (
    (() => {
      // 답할 Gate 는 스냅숏에서 다시 찾는다 — 폼을 연 뒤에 그 Gate 가 풀렸을 수 있고
      // (코디네이터나 CLI 가 답할 수 있다), 그때 열어 둔 id 로 보내면 이미 끝난 것을
      // 다시 푼다. 사라졌으면 폼을 그리지 않고 원래 화면으로 돌아간다.
      const gate = tasks.find((tk) => tk.id === a.answering)?.gate
      if (!gate) return <></>
      return (
        <GateAnswer
          gate={gate}
          answer={a.answer}
          busy={a.busy !== null}
          error={a.gateError}
          onAnswer={a.setAnswer}
          onResolve={(resolution) => void a.resolveGate(gate.id, resolution)}
          onCancel={a.cancelAnswer}
        />
      )
    })()
  ) : (
    <>
      {/* .detail-filter/.detail-clear 를 NewTaskModal 과 같이 빌린다 — 무엇을 하고 있는지
          보여 주던 자리를 그대로 쓴다 */}
      <div className="detail-filter">
        <b>{t('jobs.node.gate')}</b>
        <IconButton className="plan-clear" size="sm" icon={<X size={14} />} label={t('common.cancel')} onClick={a.cancelAsk} />
      </div>
      <div className="detail-task-fields">
        <div className="field">
          <label htmlFor="plan-gate-question">{t('jobs.node.gateQuestion')}</label>
          <Textarea id="plan-gate-question" rows={4} value={a.question} onChange={(e) => a.setQuestion(e.target.value)} autoFocus />
        </div>
        {/* NewTaskModal 과 같은 자리 — 이 폼에만 있는 실패는 이 폼 안에서 죽는다 */}
        {a.gateError && <p className="warn">{a.gateError}</p>}
      </div>
      <div className="row right">
        <Button variant="ghost" size="sm" onClick={a.cancelAsk} disabled={a.busy !== null}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={a.busy !== null || !a.question.trim()} onClick={() => void a.askQuestion()}>
          {t('jobs.node.gate')}
        </Button>
      </div>
    </>
  )
}
