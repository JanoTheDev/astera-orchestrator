// The dependency graph of the Waves section (moved out of pages/PlanPage.tsx): one row per layer, the edges coloured by
// whether they still wait. Drawing only; the page decides what a click means. W12: the node controls are ui IconButtons,
// the title is a ui Button (the keyboard's way to select a node), a layer is shown as "Step n" and a waiting node's
// title says why it waits (planBoard reasonText).
import { useEffect, useRef, useState } from 'react'
import type { JobTask, TaskStatus } from '../../../../core/types'
import { chainOf } from '../../../../core/orchestration/graph'
import type { GraphBox } from '../../../../core/orchestration/graphLayout'
import { edgePath, layoutRows, NODE_H, NODE_W } from '../../../../core/orchestration/graphLayout'
import { canStopConvergence, nodeMetaOf, retryingCheckOf } from '../../../../core/orchestration/nodeMeta'
import { useI18n } from '../../i18n/I18nProvider'
import { checkTooltip, nodeMetaText, type GlyphKind } from '../checkText'
import { STATUS_COLOR, TaskGlyph } from '../JobIcons'
import { Button, Icon, IconButton, Menu, menuPointOf, type IconName } from '../ui'
import { reasonText } from './planBoard'
import { taskActionOf } from './planCommands'
import { taskMenuItems, type OnTaskAction } from './TaskActionMenu'

/** A check's state as a registry icon, in place of the old glyph characters (checkText GLYPH). */
const CHECK_ICON: Record<GlyphKind, IconName> = {
  passed: 'check',
  failed: 'close',
  'timed-out': 'close',
  'not-run': 'pending',
  error: 'warning',
  retrying: 'loading'
}

/** W17: the graph shrinks to its box's width down to `min` (its nodes stay readable), then scrolls instead of squashing;
 *  it never grows past its drawn size. An unmeasured box (0) draws it as laid out. */
export function graphZoomOf(boxWidth: number, graphWidth: number, min = 0.7): number {
  if (boxWidth <= 0 || graphWidth <= 0) return 1
  return Math.min(1, Math.max(min, boxWidth / graphWidth))
}

/** 노드 테두리의 색. 시작 전 둘과 끝난 것은 선을 세우지 않는다 — 안의 글리프가 이미 그 셋을 말하고
 *  있고, 그래프에서 눈이 가야 하는 것은 지금 도는 것과 손이 필요한 것이다. */
const borderOf = (status: TaskStatus): string =>
  status === 'pending' || status === 'ready' || status === 'completed'
    ? 'var(--line-soft)'
    : STATUS_COLOR[status]

/** 범례의 선 견본. **그래프에 그려지는 것과 같은 모양이어야 한다** — 화살촉을 빼면 방향이라는
 *  신호가 범례에만 없고, 굵기를 맞추지 않으면 두 선의 차이가 색 하나로만 남는다. 색은 CSS 가
 *  준다(그래프의 선과 같은 클래스다). */
function LegendLine({ kind }: { kind: 'wait' | 'done' }): React.JSX.Element {
  return (
    <svg className="detail-line" width="22" height="7" viewBox="0 0 22 7" aria-hidden="true">
      <path
        className={`detail-edge-${kind}`}
        d="M0 3.5h13"
        fill="none"
        strokeWidth={kind === 'done' ? 1.4 : 1.8}
      />
      <polygon className={`detail-arrow-${kind}`} points="13 0, 22 3.5, 13 7" />
    </svg>
  )
}

/** 의존 그래프. 층 하나가 줄 하나이고, 같은 층은 나란히 선다.
 *
 *  **선의 색이 대기의 이유다** — 의존이 이미 `completed` 면 회색(풀린 의존), 아니면 청록(지금
 *  기다리는 중인 의존)이다. 그래서 "청록 선 둘이 한 노드로 모인다"가 곧 "저것은 둘을 기다린다"이다.
 *
 *  선은 `layers` 가 아니라 `deps` 로 긋는다 — 층은 자리만 정한다. 층 사이를 전부 이으면 있지도 않은
 *  의존이 청록으로 그려지고(같은 층의 노드들은 서로 무관하다), 그러면 위 문장이 거짓이 된다. */
export function Graph({
  tasks,
  layers,
  deps,
  cyclic,
  selected,
  onSelect,
  canOpenSession,
  onOpenSession,
  canManualStart,
  formOpen,
  onStart,
  onStop,
  onGate,
  onAnswer,
  onRestart,
  onStopConvergence,
  lockedReason,
  onTaskAction,
  accountLabel = (id) => id
}: {
  tasks: JobTask[]
  layers: string[][]
  deps: Record<string, string[]>
  cyclic: string[]
  selected: string | undefined
  /** null 이면 평소(필터 모드) — 배열이면 그 배열에 든 것이 지금 고른 의존이다. onSelect 뒤에서
   *  RunDetail 이 이미 모드를 갈랐으므로(onNodeClick) 여기서는 어느 쪽 뜻인지 몰라도 그리기만 하면
   *  된다: 이 컴포넌트는 판단하지 않는다는 파일 머리말의 규칙과 같다. */
  onSelect: (taskId: string) => void
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  /** 띄우기 버튼을 보일지 — 이 Run 의 동시 실행 한도가 1 이하이고 **그리고** provider 가 있을
   *  때만이다(RunDetail.canManualStart 의 주석에 둘 다, 각각 왜인지 적혀 있다). 판단은
   *  RunDetail 이 하고 여기는 결과만 받는다 — 이 컴포넌트는 판단하지 않는다는 파일 머리말의
   *  규칙과 같다. */
  canManualStart: boolean
  /** Task 짓기 폼이 열려 있거나, 질문을 쓰는 중이거나, 명령이 도는 중이다(RunDetail.formOpen).
   *  참이면 노드의 버튼(↗ 포함)을 전부 숨긴다 — 다른 버튼을 눌러 지금 하는 일을 조용히 버리지
   *  못하게 한다. */
  formOpen: boolean
  onStart: (taskId: string) => void
  onStop: (taskId: string) => void
  /** 물어보기 버튼을 누른 결과 — 명령을 바로 보내지 않고 질문을 쓸 폼을 연다(RunDetail 이 asking
   *  을 세운다) */
  onGate: (taskId: string) => void
  /** 답하기 버튼을 누른 결과 — onGate 와 같은 관례로 명령을 보내지 않고 답을 쓸 폼을 연다 */
  onAnswer: (taskId: string) => void
  onRestart: (taskId: string) => void
  /** 자동 수정 중지 (설계 §4.1). 누르면 확인 창을 먼저 띄운다 — 이 컴포넌트는 그것을 모르고,
   *  onGate·onAnswer 와 같은 관례로 결과만 위로 올린다 */
  onStopConvergence: (taskId: string) => void
  /** Why the node actions are off (a read-only pairing, Phase 7): drawn disabled with this as their title. */
  lockedReason?: string
  /** Present: a node opens the right-click menu of its Task's actions (taskActions). It works while `formOpen` hides the icons. */
  onTaskAction?: OnTaskAction
  /** W12: an account id as the name the person gave it, for a waiting node's "why" (reasonText). */
  accountLabel?: (id: string) => string
}): React.JSX.Element {
  const { t } = useI18n()
  const [menu, setMenu] = useState<{ x: number; y: number; task: JobTask } | null>(null)
  const byId = new Map(tasks.map((tk) => [tk.id, tk]))
  // 스냅샷에 없는 id 는 버린다 — detail 과 스냅샷은 서로 다른 호출이라 한쪽이 한 박자 낡을 수 있고,
  // 그때 제목도 상태도 없는 빈 상자를 그리게 된다
  const pick = (ids: string[]): JobTask[] =>
    ids.map((id) => byId.get(id)).filter((tk): tk is JobTask => tk !== undefined)
  const rows = layers.map(pick).filter((r) => r.length > 0)
  const cycle = pick(cyclic)
  const layout = layoutRows(rows.map((r) => r.length))
  // W17: the tab's width, so the graph scales with it (graphZoomOf)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 그려진 노드의 자리. 선은 이 표에 양쪽 끝이 다 있을 때만 그어진다 — 순환에 든 Task 를 가리키는
  // 의존은 끝점이 없고(그 묶음에는 자리가 없다), 그래서 저절로 빠진다
  const posOf = new Map<string, GraphBox>(
    rows.flatMap((row, i) => row.map((task, j) => [task.id, layout.rows[i][j]] as const))
  )
  // 고른 Task 의 의존 사슬. 고른 것이 없으면 undefined 이고, 그때는 아무것도 물러나지 않는다 —
  // "전부 사슬 밖"과 "고른 것이 없다"는 다른 상태다(빈 Set 으로 두면 그래프 전체가 흐려진다).
  const chain = selected === undefined ? undefined : chainOf(deps, selected)

  const node = (task: JobTask, pos?: GraphBox): React.JSX.Element => {
    const sessionId = task.sessionId && canOpenSession(task.sessionId) ? task.sessionId : undefined
    // 열린 Dispatch 가 있는지는 provider(그리고 startedAt)의 유무로만 안다 — 스냅샷에 Dispatch
    // 배열 자체가 없으므로 이것이 유일한 신호다(view.ts 의 jobTaskOf 주석과 brief 의 Step 2).
    const dispatchOpen = task.provider !== undefined
    // **계정이 없으면 띄울 수 없다** — provider 가 그 계정에서 나오므로 worker-start 에 --agent 로
    // 지목할 것이 없다(canManualStart 의 2번). 스케줄러가 같은 Task 를 건너뛰는 것과 같은 판단이다
    // (schedule.ts 의 slotsToFill).
    const showStart =
      canManualStart &&
      (task.accountIds?.length ?? 0) > 0 &&
      (task.status === 'ready' || task.status === 'pending')
    const showGate = task.status === 'ready' || task.status === 'pending'
    const showStop = task.status === 'dispatched' && dispatchOpen
    const showContinue = taskActionOf(task) === 'continue'
    const showRestart = task.status === 'failed' || (task.status === 'dispatched' && !dispatchOpen) || showContinue
    // 열린 Gate 가 있어야 답할 것이 있다. gate 없는 blocked 는 주인에게 붙들린 Task 다(holdForOwner)
    // — 그쪽은 답할 것이 없으니 위의 Continue 가 맡는다
    const showAnswer = task.status === 'blocked' && task.gate !== undefined
    // 제목 아래 한 줄. **없으면 줄을 그리지 않는다** — 스냅숏이 이 값을 주지 않는 Task 가 더
    // 많고(끝난 것, 아직 안 뜬 것), 빈 줄을 두면 그 카드들의 제목이 가운데에서 위로 밀려 한
    // 그래프 안에서 제목의 높이가 두 가지가 된다. 무엇을 쓰는지는 core 의 nodeMetaOf 가 정한다 —
    // Gate 질문 → 막힌 검사 → 도는 검사 → 검토 라운드 → provider. 여기서는 kind 를 문장으로 바꾸기만
    // 한다(렌더러에는 테스트가 없다).
    const meta = nodeMetaText(nodeMetaOf(task), t)
    // validating 이면 지금 다시 도는 검사 하나를 ● 로 그린다 — 지난 라운드에 막힌 것, 지난 라운드가 다 통과했으면
    // (검토 실패로 되돌아온 라운드) 첫 검사(checkTooltip 의 주석). nodeMetaOf 의 checking.retrying 과 같은 함수를
    // 써서 meta 문구와 이 칩이 서로 다른 검사를 가리키는 일이 없게 한다.
    const retrying = retryingCheckOf(task)
    // 고른 Task 와 의존으로 닿지 않는 것. 이 Task 를 멈춰도 저것은 멈추지 않는다는 뜻이다
    const away = chain !== undefined && !chain.has(task.id)
    // W12: why it waits, in plain words — the board card's reason line, here on the node's title (NODE_H has no room for a line)
    const reason = task.board?.reason
    const why = reason ? reasonText(reason, Date.now(), accountLabel) : undefined
    const tip = why ? `${task.title} — ${t(why.key, why.params)}` : task.title
    const cls = ['detail-node', `detail-node--${task.status}`, away ? 'away' : '']
      .filter(Boolean)
      .join(' ')
    return (
      <div
        key={task.id}
        className={cls}
        style={{
          width: NODE_W,
          height: NODE_H,
          borderColor: borderOf(task.status),
          // 고른 표시. **borderOf 가 아니라 STATUS_COLOR 다** — 시작 전 둘과 끝난 것은 테두리를
          // 세우지 않으므로(borderOf 가 --line-soft 를 준다) 그 색으로 링을 그리면 그 셋은 골라도
          // 아무 일도 일어나지 않는다. 자기 상태색이라 어느 노드에서도 색이 겹쳐 싸우지 않는다.
          ...(selected === task.id
            ? { boxShadow: `inset 0 0 0 2px ${STATUS_COLOR[task.status]}` }
            : {}),
          ...(pos ? { left: pos.x, top: pos.y } : {})
        }}
        onClick={() => onSelect(task.id)}
        onContextMenu={
          onTaskAction
            ? (e) => {
                e.preventDefault()
                setMenu({ ...menuPointOf(e), task })
              }
            : undefined
        }
        title={tip}
      >
        {/* 글리프는 왼쪽 칸에서 두 줄에 걸쳐 선다 — 제목 줄에만 붙이면 부제가 있는 카드에서
            글리프가 위로 딸려 올라가 카드마다 다른 높이에 놓인다(styles.css 의 grid-row: 1 / -1) */}
        <span className="detail-node-sig">
          <TaskGlyph task={task} />
        </span>
        {/* 제목이 키보드의 클릭 자리다 — 노드 안에 버튼이 있어 노드 자체를 버튼으로 둘 수 없다(TaskBoard 카드와 같은 모양) */}
        <Button
          variant="ghost"
          size="sm"
          className="detail-node-title"
          aria-pressed={selected === task.id}
          title={tip}
          onClick={(ev) => {
            ev.stopPropagation()
            onSelect(task.id)
          }}
        >
          {task.title}
        </Button>
        {meta !== undefined && <span className="detail-node-meta">{meta}</span>}
        {/* 검사 칩 한 줄 — 검사가 걸린 Task 만(없으면 요소도 없다: NODE_H 안에서 제목·meta 두 줄이 가운데 서는
            지금 모양을 그대로 두려면 빈 줄을 세우면 안 된다). meta 줄과 따로인 이유는 Gate 질문이 meta 를 차지해도
            무엇이 깨졌는지 보여야 하기 때문이다(UI 설계 U5). 통과한 것까지 전부 그린다 — 몇 개 중 어디서 멈췼는지
            한눈에(U6). */}
        {task.checks && task.checks.length > 0 && (
          <span className="detail-checks">
            {task.checks.map((c) => {
              const glyph: GlyphKind = retrying !== null && c.configId === retrying.configId ? 'retrying' : c.status
              return (
                <span key={c.configId} className={`detail-check detail-check--${glyph}`} title={checkTooltip(c, glyph, t)}>
                  <Icon name={CHECK_ICON[glyph]} size={14} />
                  {c.unstable && <sub>~</sub>}
                </span>
              )
            })}
          </span>
        )}
        {/* 세션 열기·띄우기·멈추기·물어보기·다시 띄우기 — 노드 안의 버튼들. formOpen 인 동안은
            전부 숨긴다: Task 짓기·질문 쓰기 폼이 열려 있거나 다른 명령이 도는 동안 이 버튼 중
            하나를 누르면 그 폼이나 그 명령의 결과를 조용히 버리게 된다(RunDetail.formOpen 의
            주석). 세션 열기(↗)는 원래 있던 버튼이지만 이 규칙은 새로 더한 네 버튼과 똑같이
            적용한다 — 노드 버튼이 하나든 다섯이든 "폼이 열려 있는 동안 무엇을 하는가"의 답은
            하나여야 한다.
            각 버튼은 onClick 에서 stopPropagation 을 부른다 — 노드 자신의 onClick(필터)으로
            새지 않게 한다. */}
        {!formOpen && (
          <span className="detail-node-acts">
            {sessionId && (
              <IconButton
                size="sm"
                className="detail-node-act detail-node-jump"
                label={t('plan.card.focus')}
                icon={<Icon name="open" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onOpenSession(sessionId)
                }}
              />
            )}
            {showStart && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t('jobs.node.start')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t('jobs.node.start')}
                icon={<Icon name="run" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onStart(task.id)
                }}
              />
            )}
            {showGate && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t('plan.graph.gate')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t('plan.graph.gate')}
                icon={<Icon name="lock" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onGate(task.id)
                }}
              />
            )}
            {/* 답하기 — Gate 가 열려 있는 blocked 노드에만. 이 버튼이 이 슬라이스의 전부다: 앱은
                Gate 를 열고(위 `?`) 보여 주기만 하고 푸는 곳이 아무 데도 없었다. */}
            {showAnswer && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t('plan.graph.answer')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t('plan.graph.answer')}
                icon={<Icon name="unlock" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onAnswer(task.id)
                }}
              />
            )}
            {showStop && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t('jobs.node.stop')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t('jobs.node.stop')}
                icon={<Icon name="stop" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onStop(task.id)
                }}
              />
            )}
            {showRestart && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t(showContinue ? 'plan.task.continue' : 'jobs.node.restart')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t(showContinue ? 'plan.task.continue' : 'jobs.node.restart')}
                icon={<Icon name="refresh" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onRestart(task.id)
                }}
              />
            )}
            {/* 자동 수정 중지 (설계 §4.1, 명세 §29 의 Stop Auto-Fix). 보일 조건은 core 가 정한다 —
                자동 수정이 걸려 있고, 아직 안 멈췄고, 끝나지 않은 Task 만. 되돌릴 수 없는 버튼이라
                확인 창이 먼저 뜬다(RunDetail 의 stopConvergence). */}
            {canStopConvergence(task) && (
              <IconButton
                size="sm"
                className="detail-node-act"
                label={t('jobs.convergence.stop')}
                disabled={lockedReason !== undefined}
                title={lockedReason ?? t('jobs.convergence.stop')}
                icon={<Icon name="stopFix" size={14} />}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onStopConvergence(task.id)
                }}
              />
            )}
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      {menu && onTaskAction && (
        <Menu
          at={menu}
          onClose={() => setMenu(null)}
          label={t('plan.taskMenu.label')}
          items={taskMenuItems(
            menu.task,
            { canManualStart, consoleOpen: menu.task.sessionId !== undefined && canOpenSession(menu.task.sessionId) },
            t,
            lockedReason,
            onTaskAction
          )}
        />
      )}
      {/* 스크롤은 **이 안에서만** 돈다 — 범례는 이 밖에 있어 무엇을 스크롤하든 칸의 왼쪽 아래에
          그대로 붙어 있다. 선의 색을 설명하는 글이 스크롤에 밀려 사라지면, 색을 물어볼 자리가
          화면에서 없어진다(선에는 툴팁을 달 곳이 없다). */}
      <div className="detail-scroll" ref={scrollRef}>
        <div className="detail-canvas" style={{ width: layout.width, height: layout.height, zoom: graphZoomOf(boxWidth, layout.width) }}>
          <svg className="detail-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              {/* 화살촉은 marker 라 참조한 path 의 stroke 를 물려받지 못한다 — 색마다 하나씩 둔다.
                  refX 를 markerWidth 와 같게 두면 촉의 끝이 path 의 끝점, 곧 상자의 위 가장자리에
                  정확히 선다. markerUnits 를 userSpaceOnUse 로 두는 것은 굵기가 다른 두 선의
                  화살촉 크기가 같아야 하기 때문이다(기본값은 stroke-width 를 곱한다). */}
              <marker
                id="detail-arrow-wait"
                markerWidth="9"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <polygon className="detail-arrow-wait" points="0 0, 9 3.5, 0 7" />
              </marker>
              <marker
                id="detail-arrow-done"
                markerWidth="9"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <polygon className="detail-arrow-done" points="0 0, 9 3.5, 0 7" />
              </marker>
            </defs>

            {/* 층의 띠. 무엇이 같은 층인지는 이것이 없으면 y 좌표로만 짐작해야 하고, 한 층에
                하나뿐인 층이 섞이면 그 짐작이 틀린다. 띠는 가장 넓은 층보다 좌우로 더 나가므로
                그림이 어디까지인지도 이것이 말한다. 자리는 graphLayout 이 준다 */}
            {layout.lanes.map((lane, i) => (
              <g key={`lane:${i}`}>
                <rect
                  className="detail-lane"
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  rx="10"
                  strokeWidth="1"
                  strokeDasharray="6 6"
                />
                <text className="detail-lane-label" x={lane.x + 20} y={lane.labelY}>
                  {t('plan.steps.title', { n: i + 1 })}
                </text>
              </g>
            ))}

            {rows.flat().map((task) => {
              const to = posOf.get(task.id)
              if (to === undefined) return null
              // **그려지는 의존만 센다.** 순환에 든 Task 를 가리키는 의존은 끝점이 없어 빠지는데
              // (그 묶음에는 자리가 없다), 그것까지 세면 남은 화살표들이 상자 가운데를 비켜서서
              // 하나뿐인 의존조차 중앙에 꽂히지 않는다.
              const arrivals = (deps[task.id] ?? []).flatMap((depId) => {
                const from = posOf.get(depId)
                return from === undefined ? [] : [{ depId, from }]
              })
              return arrivals.map(({ depId, from }, index) => {
                const done = byId.get(depId)?.status === 'completed'
                // 선은 **양 끝이 다 사슬 안일 때만** 남는다 — 한쪽만 걸친 선을 남기면 물러난
                // 노드로 들어가는 밝은 선이 생겨, 흐려진 것이 정말 무관한지 다시 눈으로 따져야 한다
                const away = chain !== undefined && !(chain.has(depId) && chain.has(task.id))
                return (
                  <path
                    key={`${depId}:${task.id}`}
                    className={`detail-edge-${done ? 'done' : 'wait'}${away ? ' away' : ''}`}
                    d={edgePath(from, to, { index, count: arrivals.length })}
                    fill="none"
                    strokeWidth={done ? 1.4 : 1.8}
                    markerEnd={`url(#detail-arrow-${done ? 'done' : 'wait'})`}
                  />
                )
              })
            })}
          </svg>
          {rows.map((row, i) => row.map((task, j) => node(task, layout.rows[i][j])))}
        </div>
        {/* 순환. **서로 간 선을 긋지 않는다** — 그을 순서가 없다는 것이 바로 이 묶음이 여기 있는
            이유다. 명령으로는 만들 수 없고(createTask 가 없는 dep 을 거절하고 deps 를 바꾸는 명령이
            없다) 저장 파일이 손으로 고쳐졌을 때만 생기는데, 그래서 더더욱 이 화면 말고는 아무도
            말해 주지 않는다. 조용히 숨기지 않는 이유다 */}
        {cycle.length > 0 && (
          <div className="detail-cycle">
            <p className="detail-cycle-note">{t('jobs.detail.cycle')}</p>
            <div className="detail-cycle-nodes">{cycle.map((task) => node(task))}</div>
          </div>
        )}
      </div>
      {/* 선이 하나도 없는 그래프에는 설명할 색도 없다 */}
      {rows.flat().some((task) => (deps[task.id] ?? []).some((d) => posOf.has(d))) && (
        <div className="detail-legend">
          <span>
            <LegendLine kind="wait" />
            {t('jobs.detail.edgeWaiting')}
          </span>
          <span>
            <LegendLine kind="done" />
            {t('jobs.detail.edgeResolved')}
          </span>
        </div>
      )}
    </>
  )
}
