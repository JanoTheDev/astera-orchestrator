import { useState } from 'react'
import type { Account, JobTask } from '../../../core/types'
import { providerOf } from '../../../core/providers/meta'
import { useI18n } from '../i18n/I18nProvider'
import { formFailure, isOutcomeUnknown, replyNote, type OrchDoor } from '../lib/orchDoor'
import { AccountDisclosure, AccountSelect } from './AccountSelect'
import { Button, Field, Icon, IconButton, Modal, Checkbox } from './ui'
import './formDialogs.css'
import { DepsPicker, PlanFields } from './plan/TaskEditModal'
import { addTaskRequestOf, createArgsOf, placementLineOf, taskModeOf } from './plan/taskEdit'
import { openConsole } from './shell/navigation'

/** 계정 슬롯 최대 개수. 새 세션 대화상자의 MAX_ROLL_ACCOUNTS 와 같은 값이지만 **상수를 공유하지
 *  않는다** — 저쪽은 탭 세션의 롤링이고 이쪽은 Task 의 체인이다. 한쪽을 늘릴 때 다른 쪽이 따라
 *  움직이면 안 된다. core·CLI 에는 상한이 없다(롤링 코디네이터에 상한이 없다) — 이것은 레이아웃
 *  사정이고, 이 폼은 만들기 전용이라 CLI 로 넷 이상 지정한 Task 를 여기서 보여 줄 일이 없다. */
const MAX_TASK_ACCOUNTS = 3

/** Task 를 짓는 폼. 예전에는 상세 창의 아래 칸(.detail-events)을 통째로 바꿨는데, 640px 높이에서 단계 보드가
 *  두 줄로 눌렸다. 지금은 ui Modal 이라 보드는 그대로 두고(뒤에서 어둡게 보인다) 폼이 자기 높이를 갖는다.
 *  아래의 옛 설명은 위치에 관한 것이라 낡았다 — 필드와 규칙은 그대로다.
 *
 *  (옛) RunDetail 의 그래프가 Task 를 짓는 동안 상세 창의 아래 칸(.detail-events)이 통째로 바뀌는 폼.
 *  이름은 NewRunModal 을 따랐지만 그 컴포넌트처럼 `.modal-backdrop` 을 새로 세우지 않는다 — 그 배경은
 *  화면 전체의 클릭을 삼킨다. **예전 이유는 "위의 그래프가 계속 눌려야 한다"였다** — 의존을 그래프
 *  노드를 눌러 골랐기 때문이다. 지금은 폼 안의 셀렉트로 고르므로 그 이유는 없어졌고, 그래도 이 자리에
 *  남는 이유는 바뀌었다: 의존을 **이름으로** 고르는 동안 위 그래프가 계속 **보여야** 한다. 무엇에
 *  붙이는지 판단할 근거가 그 그림이고, 새 모달을 세우면 그것을 가린다.
 *
 *  NewRunModal 과 같은 관례로 로컬 draft 만 들고(제출 버튼 하나로 끝나는 한 번짜리 폼, flush/onBlur
 *  배선 없음), 실패해도 폼을 닫지 않는다 — 닫으면 에러를 보여줄 자리가 없어진다. */
export function NewTaskModal({
  door,
  runId,
  tasks,
  accounts,
  runConfigs,
  initialDeps,
  planned,
  onClose,
  onCreated
}: {
  /** Where the Task is made: this computer or a paired Runtime (lib/orchDoor.ts, Phase 7). */
  door: OrchDoor
  runId: string
  /** 이 Run 의 Task 들 — 의존 셀렉트의 항목이다. 제목이 필요하므로 id 목록으로는 안 된다.
   *  자기 자신은 아직 만들어지지 않았으므로 목록에 있을 수가 없고, 그래서 "자신을 의존으로 고르는"
   *  경우를 걸러 낼 필요가 없다. */
  tasks: JobTask[]
  /** 고를 수 있는 계정 — **provider 로 걸러지지 않은 전부**다. 이 폼에서 고른 첫 계정이 이 Task 의
   *  provider 를 정하므로(orchestration/types.ts 의 Task.accountIds), 걸러 올 기준이 부르는 쪽에
   *  없다. 둘째 칸부터 첫 계정의 provider 로 좁히는 일은 이 폼이 한다. null 은 아직 안 온 것 */
  accounts: Account[] | null
  /** 검증 구성 목록. null 은 아직 안 온 것. The checks a Task can name: the run configurations, then this computer's
   *  check plugins as `plugin:<id>` (plugin Phase 5 C6, RunDetail's checkChoicesOf) */
  runConfigs: { id: string; name: string }[] | null
  /** The Tasks the form starts with as dependencies ("Add task to this step": the previous step's Tasks). Still editable. */
  initialDeps?: readonly string[]
  /** The plan has a planner (JobRow.planned): the window opens on the planner's box; else on the manual form. */
  planned?: boolean
  onClose: () => void
  onCreated: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  /** 고른 의존. **이 폼이 소유한다** — 예전에는 그래프가 들고 있었다(고르는 자리가 그래프였다).
   *  셀렉트로 옮기면서 값과 그 값을 고치는 화면이 같은 자리에 있게 됐다. */
  const [deps, setDeps] = useState<string[]>(() => [...(initialDeps ?? [])])
  /** T2: the planner's fields, optional: sent only when filled (createArgsOf) */
  const [plan, setPlan] = useState({ prompt: '', criteria: '', kind: '' })
  /** T2: the description went to the planner instead (`jobs-feedback`): the planner adds the Task, this form makes none */
  const [asked, setAsked] = useState(false)
  const [mode, setMode] = useState<'ai' | 'manual'>(() => taskModeOf(planned))
  /** The planner's session from the jobs-feedback reply, for "Open planner" */
  const [plannerSession, setPlannerSession] = useState<string | null>(null)
  /** 이 Task 를 띄울 계정들, 순서대로. **빈 배열이 Auto 다**(Auto, most room) — task-create 가 `account` 없이도
   *  받고, 그때는 앱이 provider 의 계정을 여유 순으로 골라 띄운다. 계정을 고르는 것은 다른 계정에서
   *  일을 떼어 놓고 싶을 때뿐이라 칸은 접혀 있다.
   *
   *  첫 계정으로 띄우고 나머지는 한도에 걸렸을 때 갈아탈 순서다. **첫 칸을 비우면(Auto) 뒤 칸도 함께
   *  사라진다** — 첫 계정이 provider 를 정하므로 그것 없이 "두 번째 계정" 만 있는 상태는 뜻이 없다. */
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [acctOpen, setAcctOpen] = useState(false)
  /** 완료 검사 — 고른 RunConfig id, **이 순서가 실행 순서다**(Plan 1 설계 D9: 첫 실패에서 멈춘다). 그래서 Set 이
   *  아니라 배열이고, 순서를 바꾸는 손잡이(↑↓)가 있다. */
  const [checks, setChecks] = useState<string[]>([])
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The Task may have been made on a Runtime whose answer was lost: not sent again from this form. */
  const [locked, setLocked] = useState(false)

  /** 검사 목록의 도우미. runConfigs 가 null(아직 안 온 것)이면 칸 자체를 접으므로(아래 마크업) 여기서는 빈 배열로 본다 */
  const configs = runConfigs ?? []
  const checkNameOf = (id: string): string => configs.find((c) => c.id === id)?.name ?? id
  const unpicked = configs.filter((c) => !checks.includes(c.id))
  const addCheck = (id: string): void => setChecks((xs) => [...xs, id])
  const removeCheck = (id: string): void => setChecks((xs) => xs.filter((x) => x !== id))
  /** 이웃과 자리를 바꾼다. 끝에서는 부르는 쪽 버튼이 disabled 라 범위 밖으로 가지 않는다 */
  const moveCheck = (i: number, dir: -1 | 1): void =>
    setChecks((xs) => {
      const ys = [...xs]
      ;[ys[i], ys[i + dir]] = [ys[i + dir], ys[i]]
      return ys
    })

  /** 뒤에 빈 칸을 하나 더 세울지 — **그 칸에서 고를 것이 남았을 때만 세운다.** 이미 고른 계정은 다른
   *  칸의 항목에서 빠지므로(아래 filter), 계정이 하나뿐인 사람이 그것을 고르면 둘째 칸의 목록이 비고
   *  '추가 안 함' 한 줄만 있는 죽은 드롭다운이 남는다 — 계정이 하나인 사람이 가장 흔한 경우다.
   *  새 세션 대화상자가 '계정 추가' 버튼에 같은 판단을 쓴다(NewSessionDialog.tsx 의 canAdd).
   *  상한도 여기서 본다: 이것이 칸을 늘리는 유일한 길이므로 accountIds 는 상한을 넘을 수 없다. */
  /** 첫 계정이 정한 provider. 아직 아무것도 안 골랐거나 그 id 가 목록에 없으면 null — 그때는
   *  좁힐 기준이 없으므로 모든 칸이 전부 보여 준다. */
  const head = (accounts ?? []).find((a) => a.id === accountIds[0])
  const headProvider = head ? providerOf(head) : null

  /** 그 칸에서 고를 수 있는 계정. **둘째 칸부터는 첫 계정과 같은 provider 만 낸다** — 섞이면 첫
   *  계정으로 띄운 CLI 가 한도에 걸렸을 때 다른 CLI 의 계정으로 갈아타려 하고, 그것은 갈아타기가
   *  아니라 다른 프로그램을 띄우는 일이다. task-create 도 섞인 목록을 거절하지만(server.ts), 고를
   *  수 없게 두는 것이 거절보다 낫다 — 사람이 고른 뒤에 안 된다고 말할 일이 없다. */
  const choicesFor = (index: number, slot: string): Account[] =>
    (accounts ?? []).filter(
      (a) =>
        (a.id === slot || !accountIds.includes(a.id)) &&
        (index === 0 || headProvider === null || providerOf(a) === headProvider)
    )

  const canAddSlot =
    accountIds.length < MAX_TASK_ACCOUNTS &&
    choicesFor(accountIds.length, '').length > 0

  /** 등록된 계정이 하나도 없으면 Auto 가 고를 것도 없다 — 아래 경고가 이유를 말한다. null 은 아직 안 온 것 */
  const noAccounts = accounts !== null && accounts.length === 0

  const create = async (): Promise<void> => {
    const trimmedSpec = spec.trim()
    // busy 로 다시 걸러 이중 클릭이 Task 를 두 개 만들지 못하게 한다 — NewRunModal.create 와 같은
    // 이유다: 버튼의 disabled 는 같은 프레임에 반영되지 않을 수 있다.
    // 계정이 하나도 없는 경우도 함께 본다 — 버튼의 disabled 와 같은 조건이고, 같은 이유로 두 번 본다(위 주석).
    if (!trimmedSpec || noAccounts || busy || locked) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command('task-create', {
        // runId 를 언제나 명시한다 — task-create 의 기본값(`s.runs[마지막]`)에 기대면, 이 창이 아닌
        // 다른 프로젝트에서 방금 만들어진 Run 에 이 Task 가 들어간다(Global Constraints).
        runId,
        title: title.trim(),
        spec: trimmedSpec,
        deps,
        // 쉼표로 보낸다 — task-create 의 문법이다(server.ts). Auto 면 키를 보내지 않는다: 빈 문자열은
        // 서버가 400 으로 거절하고, 키가 없으면 앱이 계정을 고른다.
        ...(accountIds.length > 0 ? { account: accountIds.join(',') } : {}),
        // 쉼표 목록 — task-create 의 문법이다(server.ts, `--account` 와 같은 규약). 고른 순서가 실행 순서다.
        // 하나도 안 골랐으면 키를 보내지 않는다: 빈 문자열은 서버가 400 으로 거절한다.
        ...(checks.length > 0 ? { validate: checks.join(',') } : {}),
        ...(review ? { review: true } : {}),
        ...createArgsOf(plan.prompt, plan.criteria, plan.kind)
        // parent 는 보내지 않는다 — parentId 는 통합(integration) Task 의 표식이라, 이 폼에서 보내면
        // 스케줄러가 이 Task 를 병합 단계 없이 프로젝트 폴더에서 돌리는 통합 Task 로 취급하게 된다.
      })
      if (reply.status >= 400) {
        // 실패해도 폼은 닫지 않는다 — 닫으면 에러를 보여줄 자리가 없고, 사용자는 눌러도 아무 일도
        // 없었다고 여긴다(NewRunModal.create 와 같은 이유).
        const f = formFailure(reply, t as never, 'jobs.task.failed')
        setError(f.message)
        if (f.lock) setLocked(true)
        return
      }
      onCreated()
    } catch {
      // orch.command 자체가 reject 하는 경우(IPC 실패) — 거부 팔이 없으면 DevTools 에
      // Uncaught (in promise) 가 뜬다. status>=400 과 같은 문구로 접는다: 사용자에게는 둘 다
      // "만들지 못했다"이지 원인을 구분해 보여줄 이유가 없다.
      setError(t('jobs.task.failed'))
    } finally {
      setBusy(false)
    }
  }

  /** T2: hands the typed description to the planner (`jobs-feedback` on this plan), which fits the Task into the plan */
  const askPlanner = async (): Promise<void> => {
    if (!spec.trim() || busy || locked) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command('jobs-feedback', { job: runId, text: addTaskRequestOf(title, spec, placementLineOf(initialDeps ?? [], tasks)) })
      if (reply.status >= 400) {
        // the Host's own reason ("was not planned: there is no planner…"), else the generic line
        const said = (reply.body as { error?: unknown } | null)?.error
        setError(replyNote(reply, t as never, typeof said === 'string' ? said : t('jobs.task.askFailed')))
        if (isOutcomeUnknown(reply)) setLocked(true)
        return
      }
      const sid = (reply.body as { sessionId?: unknown } | null)?.sessionId
      setPlannerSession(typeof sid === 'string' ? sid : null)
      setAsked(true)
      setLocked(true)
    } catch {
      setError(t('jobs.task.askFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('jobs.task.new')}
      size="lg"
      closeLabel={t('common.cancel')}
      onClose={() => !busy && onClose()}
      footer={
        mode === 'ai' || asked ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {asked ? t('common.close') : t('common.cancel')}
            </Button>
            {!asked && (
              <Button variant="ghost" onClick={() => setMode('manual')} disabled={busy}>
                {t('jobs.task.writeMyself')}
              </Button>
            )}
            {asked ? (
              plannerSession && (
                <Button
                  variant="primary"
                  onClick={() => {
                    openConsole(plannerSession)
                    onClose()
                  }}
                >
                  {t('jobs.task.openPlanner')}
                </Button>
              )
            ) : (
              <Button variant="primary" loading={busy} disabled={locked || busy || !spec.trim()} onClick={() => void askPlanner()}>
                {t('jobs.task.addWithAi')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            {/* 계정을 안 골라도 만든다(Auto). 등록된 계정이 아예 없을 때만 막는다 */}
            <Button
              variant="primary"
              loading={busy}
              disabled={locked || busy || !spec.trim() || noAccounts}
              onClick={() => void create()}
            >
              {t('jobs.task.create')}
            </Button>
          </>
        )
      }
    >
      {mode === 'ai' || asked ? (
        <div
          className="form-stack"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !asked) {
              e.preventDefault()
              void askPlanner()
            }
          }}
        >
          <Field kind="textarea" label={t('jobs.task.aiSpec')} hint={t('jobs.task.aiHint')} rows={6} value={spec} onChange={(e) => setSpec(e.target.value)} disabled={asked} autoFocus />
          {asked && (
            <p className="ui-field__hint" role="status">
              {t('jobs.task.askedPlanner')}
            </p>
          )}
          {error && (
            <p className="ui-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
      <div className="form-stack">
        {!planned && <p className="ui-field__hint">{t('jobs.task.noPlannerHint')}</p>}
        <Field label={t('jobs.task.title')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Field kind="textarea" label={t('jobs.task.spec')} rows={4} value={spec} onChange={(e) => setSpec(e.target.value)} />
        <div className="new-task-ask">
          <Button variant="ghost" size="sm" className="plan-link" icon={<Icon name="message" size={14} />} disabled={busy || locked || !spec.trim()} onClick={() => void askPlanner()}>
            {t('jobs.task.askPlanner')}
          </Button>
          <span className="ui-field__hint">{t('jobs.task.askPlannerHint')}</span>
        </div>
        {asked && (
          <p className="ui-field__hint" role="status">
            {t('jobs.task.askedPlanner')}
          </p>
        )}
        <PlanFields draft={plan} set={(field, value) => setPlan((cur) => ({ ...cur, [field]: value }))} />
        {/* 고를 것도 고른 것도 없으면 이 칸을 아예 그리지 않는다 — Run 의 첫 Task 를 만들 때가
            그렇다(가리킬 Task 가 존재하지 않는다). 라벨과 안내문만 남기면 무엇을 해야 하는지 알 수
            없는 죽은 칸이 된다. 셀렉트만 감추는 것으로 부족한 이유가 그것이다.
            T2: the picker is shared with the edit form (plan/TaskEditModal DepsPicker) */}
        <DepsPicker label={t('jobs.task.deps')} addLabel={t('jobs.task.depsAdd')} hint={t('jobs.task.depsHint')} tasks={tasks} deps={deps} onChange={setDeps} />
        {/* **계정이 하나도 없을 때만 접는다** — 위 선행 Task 칸과 같은 규칙이다: 고를 것이 없는
            컨트롤만 감춘다. 한때 "둘 이상일 때만" 이었는데 둘이 어긋났다. (1) 계정이 하나여도
            "지정 안 함"과 "이 계정으로 못박음"은 뜻이 다르다 — 그 계정이 로그아웃되고 둘째가
            등록되면 지정 없는 Task 는 새 계정으로 조용히 넘어가고 못박은 Task 는 Gate 를 연다.
            (2) 칸이 없는 이유를 화면이 말하지 않아, 계정이 하나인 사람은 기능이 빠진 줄 안다.
            null 은 아직 안 온 것이라 같이 접힌다 */}
        {accounts !== null && (
          <div className="ui-field">
            <span className="ui-field__label">{t('jobs.task.account')}</span>
            <p className="ui-field__hint">{t('jobs.task.accountHint')}</p>
            {accounts.length > 0 && (
              <AccountDisclosure
                id="task-accounts"
                open={acctOpen}
                onToggle={() => setAcctOpen((v) => !v)}
                summary={accountIds.length > 0 ? accountIds.map((id) => accounts.find((a) => a.id === id)?.label ?? id).join(' → ') : t('accounts.auto')}
              >
              {/* 슬롯 하나씩. 첫 칸은 Auto(빈 값)를 가질 수 있고, 뒤 칸은 고른 것만 남는다 —
                  빈 뒤 칸은 뜻이 없으므로 값을 비우면 그 칸이 사라진다. 이미 고른 계정은 다른 칸의
                  항목에서 빠진다(같은 계정을 두 칸에 넣으면 롤링이 두 계정인 줄 알고 같은 계정으로
                  "갈아탄다" — task-create 도 그 조합을 거절한다). 맨 뒤의 빈 칸은 고를 것이 남았을
                  때만 붙는다(canAddSlot). */}
              {(canAddSlot ? [...accountIds, ''] : accountIds).map((slot, i) => (
                <AccountSelect
                  key={i}
                  className="stack-item"
                  accounts={choicesFor(i, slot)}
                  value={slot}
                  onChange={(id) =>
                    setAccountIds((prev) => {
                      const next = [...prev]
                      if (id === '') next.splice(i) // 이 칸부터 뒤를 버린다 — 위 주석
                      else next[i] = id
                      return next.filter((x) => x !== '')
                    })
                  }
                  // 첫 칸의 빈 값은 Auto 다 — 지정 없이 앱이 계정을 고른다(accountIds 의 주석).
                  allLabel={i === 0 ? t('accounts.auto') : t('jobs.task.accountNone')}
                />
              ))}
              </AccountDisclosure>
            )}
            {/* 계정이 하나도 등록되지 않았으면 고를 것이 없어 이 Task 를 만들 수 없다 — 칸을
                감추면 왜 만들기 버튼이 죽어 있는지 화면이 말하지 않는다. */}
            {accounts.length === 0 && (
              <p className="form-warn">
                <Icon name="warning" size={14} />
                {door.runtimeId ? t('jobs.runtime.noAccounts') : t('jobs.task.accountEmpty')}
              </p>
            )}
            {accountIds.length > 0 && (
              <p className="form-warn">
                <Icon name="warning" size={14} />
                {t('jobs.task.accountTrust')}
              </p>
            )}
          </div>
        )}
        {/* 완료 검사. 고른 순서가 실행 순서라 번호를 세우고 ↑↓ 로 바꾼다 — 첫 실패에서 멈추므로 순서가 비용을
            좌우한다. 드래그가 아닌 이유: 이 모달에 드래그 선례가 없고 셋 안팎의 목록에는 버튼이 더 빠르다. 아이콘만
            있는 버튼이라 aria-label 을 단다; 첫 항목의 ↑ 와 마지막의 ↓ 는 갈 곳이 없어 disabled. null 은 아직 안 온
            것이라 계정 칸과 같은 규칙으로 접는다. */}
        {runConfigs !== null && (
          <div className="ui-field">
            <span className="ui-field__label">{t('jobs.task.validate')}</span>
            {checks.length > 0 && (
              <ol className="detail-check-list">
                {checks.map((id, i) => (
                  <li key={id} className="detail-check-row">
                    <span className="detail-check-no">{i + 1}</span>
                    <span className="detail-check-name">{checkNameOf(id)}</span>
                    <IconButton
                      size="sm"
                      icon={<Icon name="chevronUp" size={14} />}
                      label={`${checkNameOf(id)} — ${t('jobs.task.checkUp')}`}
                      disabled={i === 0}
                      onClick={() => moveCheck(i, -1)}
                    />
                    <IconButton
                      size="sm"
                      icon={<Icon name="chevronDown" size={14} />}
                      label={`${checkNameOf(id)} — ${t('jobs.task.checkDown')}`}
                      disabled={i === checks.length - 1}
                      onClick={() => moveCheck(i, 1)}
                    />
                    <IconButton
                      size="sm"
                      icon={<Icon name="close" size={14} />}
                      label={`${checkNameOf(id)} — ${t('jobs.task.checkRemove')}`}
                      onClick={() => removeCheck(id)}
                    />
                  </li>
                ))}
              </ol>
            )}
            {/* A Runtime's plugins are its own and a controller cannot list them (C14): say where its plugin checks are added */}
            {door.runtimeId !== undefined && (
              <p className="ui-field__hint">{t('jobs.task.checksRuntimePlugins', { runtime: door.runtimeId, run: runId })}</p>
            )}
            {configs.length === 0 ? (
              <p className="ui-field__hint">{t('jobs.task.checksNone')}</p>
            ) : (
              <>
                <p className="ui-field__hint">{t('overlays.newTask.checksHint')}</p>
                {/* 다 골랐으면 이 줄이 빠진다 — 빈 "고르지 않은 것" 은 죽은 칸이다(의존 셀렉트와 같은 판단) */}
                {unpicked.length > 0 && (
                  <div className="detail-check-pick">
                    <span className="ui-field__hint">{t('jobs.task.checksUnpicked')}</span>
                    {unpicked.map((c) => (
                      <Button
                        key={c.id}
                        size="sm"
                        variant="ghost"
                        className="detail-check-add"
                        icon={<Icon name="add" size={14} />}
                        onClick={() => addCheck(c.id)}
                      >
                        {c.name}
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <Checkbox label={t('jobs.task.review')} checked={review} onChange={(v) => setReview(v)} />
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      )}
    </Modal>
  )
}
