// 검토를 누구에게 맡기는가. 순수 함수이고 배선이 계정 목록과 로그인 여부를 모아 부른다 —
// 그 둘은 main 의 것이라(core.accounts) 이 층이 직접 읽지 않는다.
import { defaultAccountIdOf } from '../accounts/defaultAccount'
import { PROVIDERS, providerOf } from '../providers/meta'
import type { Account, Provider } from '../types'
import { OWNER_ANSWER_SUBJECT, type OrchState } from './state'

/** 구현자와 **다른** provider 의 계정 하나 — 다른 provider 에 계정이 아예 없으면 같은 provider 의
 *  계정(`sameProvider`, 아래). 없으면 null(그것이 Gate 가 된다).
 *
 *  자기 코드를 자기가 읽으면 같은 맹점을 두 번 지나므로 provider 를 갈라야 한다.
 *
 *  **계정 선택 규칙을 새로 만들지 않는다.** defaultAccountIdOf 가 "그 provider 의 가장 먼저 등록된
 *  로그인 계정"을 이미 정의하고, UI 가 default 배지를 붙이는 계정도 그것이다 — 여기에 두 번째 규칙을
 *  두면 화면이 가리키는 계정과 검토가 쓰는 계정이 갈라진다.
 *
 *  provider 를 PROVIDERS 순서로 훑는다. 지금 둘뿐이라 순서가 곧 우선순위이고, 그 우선순위를
 *  정교하게 만드는 것은 4단계(Account Pool)의 일이다 — quota 와 성공률로 고르게 된다. */
export function pickReviewer(a: {
  implProvider: Provider
  accounts: readonly Account[]
  loggedInIds: ReadonlySet<string>
  /** T5b (decision 6): the provider's account with most room (chooseStartAccount), null when every one is full: that
   *  provider is then skipped. Absent, or undefined for a provider: the default account, as before. */
  best?: (provider: Provider) => string | null | undefined
}): { provider: Provider; accountId: string; sameProvider?: true } | null {
  const accountOf = (provider: Provider): string | null => {
    const best = a.best?.(provider)
    if (best === null) return null
    return best !== undefined && a.loggedInIds.has(best) ? best : defaultAccountIdOf(provider, a.accounts, a.loggedInIds)
  }
  for (const provider of PROVIDERS) {
    if (provider === a.implProvider) continue
    const accountId = accountOf(provider)
    if (accountId) return { provider, accountId }
  }
  // **Only one provider has accounts** (orchestrator W1-A, owner decision 2026-10-17): review on the
  // implementer's provider rather than not at all. The blind spot is then broken by the model instead —
  // the reviewer runs on the `reviewer` role model, never the implementer's (resolveReviewerModel). When
  // another provider does have an account that is merely logged out, this stays null: logging in is the
  // fix, and the Gate says so.
  if (a.accounts.some((x) => providerOf(x) !== a.implProvider)) return null
  const accountId = accountOf(a.implProvider)
  return accountId ? { provider: a.implProvider, accountId, sameProvider: true } : null
}

/** W8-F (#100): what the owner decided about a Task, for its review: the Gates answered on it, and the asks and
 *  escalations the owner answered (the status line `applyReply` / `answerEscalation` leave), each as "question → answer",
 *  oldest first. An owner answer can narrow a Task; the reviewer judges the Task as the owner left it. */
export function ownerAnswersOf(s: OrchState, taskId: string): string[] {
  const line = (q: string, a: string): string => `${q.replace(/\s+/g, ' ').trim().slice(0, 300)} → ${a.replace(/\s+/g, ' ').trim().slice(0, 500)}`
  const gates = s.gates.filter((g) => g.taskId === taskId && g.status === 'resolved' && g.resolution).map((g) => ({ at: g.resolvedAt ?? g.createdAt, text: line(g.question, g.resolution!) }))
  const messages = s.messages
    .filter((m) => m.taskId === taskId && m.type === 'status' && m.subject === OWNER_ANSWER_SUBJECT)
    .flatMap((m) => {
      const asked = s.messages.find((x) => x.id === m.replyTo)
      if (!asked) return []
      return [{ at: m.createdAt, text: line(asked.subject || asked.body, asked.type === 'escalation' ? (asked.answerBody ?? m.body) : m.body) }]
    })
  return [...gates, ...messages].sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.text)
}
