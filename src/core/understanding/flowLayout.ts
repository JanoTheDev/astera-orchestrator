// 흐름도의 자리 계산. graphLayout.ts 와 같은 이유로 core 에 있다 — 렌더러에는 테스트가 없다.
// 순수 함수이고 node: 모듈을 끌고 오지 않아서 tsconfig.web.json 에 들어간다.
import type { FlowNode } from './types'

/** 노드 상자의 크기. **렌더러가 이 값을 그대로 SVG 에 준다** — CSS 에 같은 숫자를 한 번 더 적으면
 *  한쪽만 고쳐졌을 때 선이 상자 가장자리에서 어긋난다(선의 끝점은 이 파일이 계산한다).
 *
 *  **모든 칸이 같은 크기다.** 라벨 길이에 맞춰 칸마다 폭을 다르게 주는 쪽이 이론적으로는 낫지만,
 *  `core/` 에는 DOM 이 없어 글자 폭을 잴 수 없다 — 글자 수로 추정해야 하고, 한글·영문·기호가 섞이면
 *  그 추정이 어긋나 결국 잘리거나 빈 공간이 남는다. 정확도를 얻지 못한 채 행 가운데 정렬과 선의
 *  끝점 계산만 복잡해지므로, 고정 크기에 두 줄까지 감싸는 쪽을 골랐다(styles.css 의 `.hiw-node`).
 *
 *  높이가 26 이 아니라 38 인 것이 그 두 줄의 자리다. 폭 150 은 패딩과 테두리를 빼면 132px 이고,
 *  11.5px 한글 기준 한 줄 약 11자 — 두 줄이면 22자쯤 담긴다. 124 × 한 줄이던 때는 9자에서 잘렸다. */
export const NODE_W = 150
export const NODE_H = 38
/** 같은 층에서 칸과 칸 사이 */
const GAP_X = 14
/** 층과 층 사이. 조건 문구가 이 사이에 들어간다 */
const GAP_Y = 30

export interface FlowBox {
  id: string
  x: number
  y: number
}

export interface FlowEdgePath {
  fromId: string
  toId: string
  condition?: string
  /** SVG path 의 d. 세로로 내려가다 가로로 꺾이는 직각 경로다 — 곡선을 쓰지 않는 이유는
   *  분기가 둘뿐이라 곡선이 주는 이점이 없고, 직각이 각진 테마(Quasar)와도 어긋나지 않기 때문이다 */
  d: string
  /** 조건 문구를 놓을 자리 */
  labelX: number
  labelY: number
}

export interface FlowLayout {
  boxes: FlowBox[]
  edges: FlowEdgePath[]
  width: number
  height: number
}

/** 각 노드의 층. 시작점에서의 최장 거리다 — **최단이 아니다.** 최단으로 재면 합류점이 짧은 갈래
 *  바로 아래에 서서, 긴 갈래의 선이 위로 거슬러 올라간다. */
function depthsOf(nodes: FlowNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depth = new Map<string, number>()
  const seen = new Set<string>()

  const visit = (id: string, stack: Set<string>): number => {
    if (stack.has(id)) return depth.get(id) ?? 0 // 순환은 깊이를 더 늘리지 않는다
    const cached = depth.get(id)
    if (cached !== undefined && seen.has(id)) return cached
    const node = byId.get(id)
    stack.add(id)
    let d = 0
    for (const n of nodes) {
      if (!n.next.some((e) => e.targetId === id)) continue
      d = Math.max(d, visit(n.id, stack) + 1)
    }
    stack.delete(id)
    if (node) {
      depth.set(id, d)
      seen.add(id)
    }
    return d
  }

  for (const n of nodes) visit(n.id, new Set())
  return depth
}

export function layoutFlow(nodes: FlowNode[]): FlowLayout {
  if (nodes.length === 0) return { boxes: [], edges: [], width: 0, height: 0 }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depth = depthsOf(nodes)

  // 층마다 그 층에 서는 노드들 — 입력 순서를 그대로 쓴다. 정렬하면 "예/아니오"의 좌우가
  // 생성한 쪽의 의도와 어긋난다
  const rows = new Map<number, string[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    const row = rows.get(d) ?? []
    row.push(n.id)
    rows.set(d, row)
  }

  const widest = Math.max(...[...rows.values()].map((r) => r.length))
  const width = widest * NODE_W + (widest - 1) * GAP_X
  const center = width / 2

  const boxes: FlowBox[] = []
  for (const [d, row] of rows) {
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X
    const left = center - rowW / 2
    row.forEach((id, i) => {
      boxes.push({ id, x: left + i * (NODE_W + GAP_X), y: d * (NODE_H + GAP_Y) })
    })
  }
  const boxOf = new Map(boxes.map((b) => [b.id, b]))

  const edges: FlowEdgePath[] = []
  for (const n of nodes) {
    for (const e of n.next) {
      const from = boxOf.get(n.id)
      const to = boxOf.get(e.targetId)
      if (!from || !to || !byId.has(e.targetId)) continue // 없는 노드를 가리키는 간선은 버린다
      const fx = from.x + NODE_W / 2
      const fy = from.y + NODE_H
      const tx = to.x + NODE_W / 2
      const ty = to.y
      const mid = fy + (ty - fy) / 2
      const d =
        fx === tx ? `M${fx} ${fy} L${tx} ${ty}` : `M${fx} ${fy} L${fx} ${mid} L${tx} ${mid} L${tx} ${ty}`
      edges.push({
        fromId: n.id,
        toId: e.targetId,
        ...(e.condition !== undefined ? { condition: e.condition } : {}),
        d,
        labelX: tx,
        labelY: mid - 3
      })
    }
  }

  const height = Math.max(...boxes.map((b) => b.y + NODE_H))
  return { boxes, edges, width, height }
}

// ── The review change map (T7): boxes of different heights in labelled groups, packed into as many columns as the
// width holds, and curved links between boxes. Additive: layoutFlow above is unchanged.

export interface AreaBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface AreaLayout {
  /** One per group: its frame, label row included. */
  groups: AreaBox[]
  boxes: AreaBox[]
  width: number
  height: number
}

export interface AreaInput {
  id: string
  items: Array<{ id: string; h: number }>
}

/** Groups packed like masonry: each next group goes into the shortest column, so the map reads left to right and stays
 *  about as tall as it is wide. Inside a group the items stack in order under a `headH` label row. */
export function layoutAreas(
  areas: readonly AreaInput[],
  opts: { width: number; colW: number; gap?: number; headH?: number; pad?: number }
): AreaLayout {
  const gap = opts.gap ?? 16
  const headH = opts.headH ?? 22
  const pad = opts.pad ?? 8
  const cols = Math.max(1, Math.min(areas.length, Math.floor((opts.width + gap) / (opts.colW + gap))))
  const heights = new Array<number>(cols).fill(0)
  const groups: AreaBox[] = []
  const boxes: AreaBox[] = []
  for (const a of areas) {
    const c = heights.indexOf(Math.min(...heights))
    const x = c * (opts.colW + gap)
    const top = heights[c]
    let y = top + headH
    for (const it of a.items) {
      boxes.push({ id: it.id, x: x + pad, y, w: opts.colW - 2 * pad, h: it.h })
      y += it.h + pad
    }
    const h = y - top
    groups.push({ id: a.id, x, y: top, w: opts.colW, h })
    heights[c] = top + h + gap
  }
  const used = Math.max(0, ...heights.map((h) => h - gap))
  return { groups, boxes, width: cols * opts.colW + (cols - 1) * gap, height: used }
}

/** A curved link from box `a` to box `b`: side to side when they are in different columns, and a loop out of the right
 *  edge when one is above the other, so a link never crosses the boxes it joins. */
export function linkPath(a: AreaBox, b: AreaBox, bow = 28): string {
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  if (b.x >= a.x + a.w) {
    const x1 = a.x + a.w
    const x2 = b.x
    const mx = (x1 + x2) / 2
    return `M${x1} ${ay} C${mx} ${ay} ${mx} ${by} ${x2} ${by}`
  }
  if (b.x + b.w <= a.x) {
    const x1 = a.x
    const x2 = b.x + b.w
    const mx = (x1 + x2) / 2
    return `M${x1} ${ay} C${mx} ${ay} ${mx} ${by} ${x2} ${by}`
  }
  const x1 = a.x + a.w
  const x2 = b.x + b.w
  const out = Math.max(x1, x2) + bow
  return `M${x1} ${ay} C${out} ${ay} ${out} ${by} ${x2} ${by}`
}
