import { describe, expect, it } from 'vitest'
import { pendingMerges } from './integrate'
import { slotsToFill, workersAgainstCap, workersAgainstCapSplit } from './schedule'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Task } from './types'
import { stateFromLegacy } from './legacyState'
import type { LegacyRun } from './legacy'

const run = (over: Partial<LegacyRun> = {}): LegacyRun => ({
  id: 'run_1',
  objective: 'o',
  cwd: '/p',
  createdAt: '2026-08-19T00:00:00.000Z',
  autoDispatch: true,
  ...over
})

// **계정 하나를 기본으로 갖는다** — 계정이 provider 의 출처이고 slotsToFill 은 계정 없는 Task 를
// 아예 고르지 않으므로, 없으면 이 파일의 거의 모든 테스트가 "고르지 않는다"를 확인하게 된다
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: 'run_1',
  title: id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
  ...over
})

// **emptyState() 위에 얹는다** — OrchState 에는 여기서 안 쓰는 칸도 있고(messages, deliveries,
// gates) 손으로 세면 하나 빠뜨려 타입체크가 깨진다. 칸이 늘어도 이 헬퍼는 그대로 산다
const state = (over: Parameters<typeof stateFromLegacy>[0] = {}): OrchState =>
  stateFromLegacy({ runs: [run()], ...over })

describe('slotsToFill — 계정 지정', () => {
  // Slot 이 계정을 실어 보내는 이유: 고르는 판정은 core 의 accountToDispatchOn 이 하지만, 그것은
  // 계정 목록과 로그인 여부를 받아야 하고 그 둘은 앱이 아는 것이다(이 파일 머리말). 그래서 이 층은
  // "사람이 무엇을 지정했나"만 실어 보내고 배선이 그 값으로 판정한다
  it('Task 에 지정된 계정을 순서대로 Slot 에 싣는다', () => {
    const s = state({ tasks: [task('t1', { accountIds: ['acc_2', 'acc_1'] })] })
    expect(slotsToFill(s)).toEqual([
      { runId: 'run_1', taskId: 't1', accountIds: ['acc_2', 'acc_1'] }
    ])
  })

  // T5b (decision 6): no account named is auto — the wiring starts it on the account with most room
  it('places a Task without accounts as auto (empty accountIds)', () => {
    const s = state({ tasks: [task('t1', { accountIds: undefined })] })
    expect(slotsToFill(s)).toEqual([{ runId: 'run_1', taskId: 't1', accountIds: [] }])
  })

  it('an empty list is auto too', () => {
    const s = state({ tasks: [task('t1', { accountIds: [] })] })
    expect(slotsToFill(s)).toEqual([{ runId: 'run_1', taskId: 't1', accountIds: [] }])
  })
})

describe('slotsToFill', () => {
  // T13: the profile's hold on new starts (startHold.ts), a restart's or the owner's
  it('places nothing while new starts are held, whatever is ready', () => {
    const s = state({ tasks: [task('t1'), task('t2')] })
    expect(slotsToFill(s, { startHeld: true })).toEqual([])
    expect(slotsToFill(s, { startHeld: false, maxConcurrentWorkers: 1 }).map((x) => x.taskId)).toEqual(['t1'])
  })

  it('autoDispatch 가 아닌 Run 은 보지 않는다 — 코디네이터가 돌리는 Run 이다', () => {
    const s = state({ runs: [run({ autoDispatch: undefined })], tasks: [task('t1')] })
    expect(slotsToFill(s)).toEqual([])
  })

  it('ready 만 고른다', () => {
    const s = state({
      tasks: [task('t1', { status: 'pending' }), task('t2'), task('t3', { status: 'blocked' })]
    })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2'])
  })

  it('상한만큼만 돌려준다 — 기본값은 DEFAULT_CONCURRENCY(3)', () => {
    const s = state({ tasks: [task('t1'), task('t2'), task('t3'), task('t4')] })
    expect(slotsToFill(s)).toHaveLength(3)
  })

  it('열린 Dispatch 가 상한을 먹는다', () => {
    const s = state({
      runs: [run({ concurrency: 2 })],
      tasks: [task('t1', { status: 'dispatched' }), task('t2'), task('t3')],
      dispatches: [
        {
          id: 'dsp_1',
          taskId: 't1',
          provider: 'claude',
          accountId: 'a',
          sessionId: 's',
          cwd: '/p',
          specPath: '/s',
          startedAt: '2026-08-19T00:00:00.000Z',
          workerState: 'ready',
          retained: false
        }
      ]
    })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2'])
  })

  it('끝난 Dispatch 는 자리를 먹지 않는다', () => {
    const s = state({
      runs: [run({ concurrency: 1 })],
      tasks: [task('t1', { status: 'completed' }), task('t2')],
      dispatches: [
        {
          id: 'dsp_1',
          taskId: 't1',
          provider: 'claude',
          accountId: 'a',
          sessionId: 's',
          cwd: '/p',
          specPath: '/s',
          startedAt: '2026-08-19T00:00:00.000Z',
          endedAt: '2026-08-19T00:01:00.000Z',
          outcome: 'succeeded',
          workerState: 'stopped',
          retained: false
        }
      ]
    })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2'])
  })

  it('회로가 차단된 Task 는 고르지 않는다 — worker-start 가 어차피 거절한다', () => {
    const s = state({ tasks: [task('t1', { consecutiveFailures: 3 }), task('t2')] })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2'])
  })

  it('순서는 tasks 배열의 순서(생성 순서)다', () => {
    const s = state({
      runs: [run({ concurrency: 2 })],
      tasks: [task('t3'), task('t1'), task('t2')]
    })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t3', 't1'])
  })

  it('Run 이 여럿이면 각자 자기 상한을 갖는다', () => {
    const s = state({
      runs: [run({ id: 'run_1', concurrency: 1 }), run({ id: 'run_2', concurrency: 1 })],
      tasks: [task('a1'), task('a2'), task('b1', { runId: 'run_2' })]
    })
    expect(slotsToFill(s)).toEqual([
      { runId: 'run_1', taskId: 'a1', accountIds: ['acc_1'] },
      { runId: 'run_2', taskId: 'b1', accountIds: ['acc_1'] }
    ])
  })

  it('ready 이면서 열린 Dispatch 를 가진 Task 는 이중으로 고르지 않는다 — 불변식이 깨져도 두 워커가 같은 Task 를 잡지 않는다', () => {
    const s = state({
      tasks: [task('t1'), task('t2')],
      dispatches: [
        {
          id: 'dsp_1',
          taskId: 't1',
          provider: 'claude',
          accountId: 'a',
          sessionId: 's',
          cwd: '/p',
          specPath: '/s',
          startedAt: '2026-08-19T00:00:00.000Z',
          workerState: 'ready',
          retained: false
        }
      ]
    })
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2'])
  })

  // 판정과 배선의 경계를 못박는다. slotsToFill 은 순수해야 하고 워크트리를 모른다 — 그래서 **아직
  // 합쳐지지 않은 Task 도 슬롯으로는 나온다.** 거르는 것은 배선이다(ipc.ts 가 pendingMerges 를 보고
  // 직접 합치거나 통합 Task 를 만든다). 이것을 적어 두지 않으면 나중에 누군가 이 함수 안에 통합
  // 검사를 넣고, 그러면 이 함수가 git 을 알아야 하므로 이 파일의 테스트 전부가 저장소를 요구하게 된다.
  it('의존이 워크트리에서 돌아 아직 합쳐지지 않은 Task 도 슬롯으로 나온다 — 거르는 것은 배선이다', () => {
    const s = state({
      tasks: [task('t1', { status: 'completed' }), task('t2', { deps: ['t1'] })],
      dispatches: [
        {
          id: 'dsp_1',
          taskId: 't1',
          provider: 'claude',
          accountId: 'a',
          sessionId: 's',
          cwd: '/p-worktrees/t1', // run.cwd('/p')가 아니다 — 워크트리에서 돌았다
          specPath: '/s',
          startedAt: '2026-08-19T00:00:00.000Z',
          endedAt: '2026-08-19T00:01:00.000Z',
          outcome: 'succeeded',
          workerState: 'stopped',
          retained: false
        }
      ]
    })
    expect(pendingMerges(s, 't2')).toEqual(['/p-worktrees/t1']) // 합칠 것이 있는데도
    expect(slotsToFill(s).map((x) => x.taskId)).toEqual(['t2']) // 슬롯으로는 나온다
  })

  // 템플릿은 정의를 담는 그릇이고, 도는 것은 발화가 만든 자식 Run 이다. 이 줄이 없으면 템플릿의
  // Task 가 직접 배치되어 예약이 곧바로 한 번 돈다
  it('schedule 을 가진 템플릿은 슬롯을 만들지 않는다', () => {
    const s = state({
      runs: [run({ schedule: { kind: 'daily', time: '09:00' } })],
      tasks: [task('t1')]
    })
    expect(slotsToFill(s)).toEqual([])
  })

  // autoDispatch 와 schedule 을 함께 가진 Run 은 명령으로는 만들 수 없다(run-create 가 예약이면
  // autoDispatch 를 켜지 않는다). 그래도 거르는 이유는 이 파일 머리말과 같다 — 입력은 명령이 아니라
  // 파일이고, orchestration.json 은 손으로 고쳐진다
  it('autoDispatch 와 schedule 을 함께 가진 Run 도 건너뛴다', () => {
    const s = state({
      runs: [run({ autoDispatch: true, schedule: { kind: 'interval', minutes: 30 } })],
      tasks: [task('t1')]
    })
    expect(slotsToFill(s)).toEqual([])
  })

  // 자식은 평범한 Run 이다 — templateId 는 어느 템플릿의 회차인지만 말하고 배치를 막지 않는다
  // 사용자가 Task 를 다 짜고 '실행' 을 누르기 전까지는 돌지 않는다. **autoDispatch 와 따로 두는
  // 이유**: 그것을 끄면 "아직 시작 안 한 UI Run" 과 "코디네이터가 돌리는 Run" 이 구별되지 않는다
  // (둘 다 autoDispatch 가 없다). 그러면 시작 버튼을 코디네이터 Run 에도 보이게 되고, 앱과
  // 코디네이터가 같은 ready Task 를 두고 경합한다 — Run.autoDispatch 의 주석이 경고하는 그것이다
  it('pendingStart 인 Run 은 슬롯을 만들지 않는다', () => {
    const s = state({ runs: [run({ pendingStart: true })], tasks: [task('t1')] })
    expect(slotsToFill(s)).toEqual([])
  })

  it('pendingStart 가 걷히면 평소처럼 돈다', () => {
    const s = state({ runs: [run({ pendingStart: undefined })], tasks: [task('t1')] })
    expect(slotsToFill(s)).toEqual([{ runId: 'run_1', taskId: 't1', accountIds: ['acc_1'] }])
  })

  it('자식 Run(templateId 만 있는) 은 평소처럼 돈다', () => {
    const s = state({ runs: [run({ templateId: 'run_tmpl' })], tasks: [task('t1')] })
    expect(slotsToFill(s)).toEqual([{ runId: 'run_1', taskId: 't1', accountIds: ['acc_1'] }])
  })
})


describe('workersAgainstCapSplit — running and starting apart', () => {
  const T0 = '2026-10-17T00:00:00.000Z'
  const state = (dispatches: Dispatch[]): OrchState => ({
    ...emptyState(),
    jobs: [{ id: 'j1', objective: 'j1', cwd: '/p', createdAt: T0, autoDispatch: true }],
    runs: [{ id: 'r1', jobId: 'j1', ordinal: 1, createdAt: T0 }],
    tasks: ['a', 'b', 'c'].map((id) => ({ ...task(id), runId: 'r1', status: 'dispatched' as const })),
    dispatches
  })
  const dispatch = (id: string, taskId: string, sessionId: string): Dispatch => ({
    id,
    taskId,
    provider: 'claude',
    accountId: 'acc_1',
    sessionId,
    cwd: '/p',
    specPath: '/spec',
    startedAt: T0,
    workerState: 'ready',
    retained: false
  })

  it('counts a Dispatch with a pending: session as starting, the rest as running', () => {
    const s = state([dispatch('d_a', 'a', 'ses_a'), dispatch('d_b', 'b', 'ses_b'), dispatch('d_c', 'c', 'pending:x1')])
    expect(workersAgainstCapSplit(s)).toEqual({ running: 2, starting: 1 })
  })

  it('workersAgainstCap is the sum of both, as before', () => {
    const s = state([dispatch('d_a', 'a', 'ses_a'), dispatch('d_c', 'c', 'pending:x1')])
    expect(workersAgainstCap(s)).toBe(2)
    expect(workersAgainstCapSplit(s)).toEqual({ running: 1, starting: 1 })
  })
})
