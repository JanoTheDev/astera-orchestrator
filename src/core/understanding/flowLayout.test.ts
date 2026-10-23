import { describe, it, expect } from 'vitest'
import type { FlowNode } from './types'
import { layoutAreas, layoutFlow, linkPath, NODE_H, NODE_W, type AreaBox, type AreaInput } from './flowLayout'

const n = (id: string, next: string[], type: FlowNode['type'] = 'step'): FlowNode => ({
  id,
  label: id,
  type,
  next: next.map((targetId) => ({ targetId }))
})

describe('layoutFlow', () => {
  it('한 줄기는 세로로 쌓이고 가로 중심이 같다', () => {
    const l = layoutFlow([n('a', ['b'], 'start'), n('b', ['c']), n('c', [], 'success')])
    const [a, b, c] = ['a', 'b', 'c'].map((id) => l.boxes.find((x) => x.id === id)!)
    expect(a.x).toBe(b.x)
    expect(b.x).toBe(c.x)
    expect(a.y).toBeLessThan(b.y)
    expect(b.y).toBeLessThan(c.y)
  })

  it('분기는 같은 층에서 중심을 두고 갈라진다', () => {
    const l = layoutFlow([
      n('q', ['yes', 'no'], 'decision'),
      n('yes', ['end']),
      n('no', ['end']),
      n('end', [], 'success')
    ])
    const q = l.boxes.find((x) => x.id === 'q')!
    const yes = l.boxes.find((x) => x.id === 'yes')!
    const no = l.boxes.find((x) => x.id === 'no')!
    expect(yes.y).toBe(no.y)
    expect(yes.y).toBeGreaterThan(q.y)
    const center = q.x + NODE_W / 2
    expect(yes.x + NODE_W / 2 - center).toBe(center - (no.x + NODE_W / 2))
  })

  it('합류점은 가장 깊은 부모 아래에 선다', () => {
    const l = layoutFlow([
      n('a', ['b', 'end'], 'start'),
      n('b', ['end']),
      n('end', [], 'success')
    ])
    const b = l.boxes.find((x) => x.id === 'b')!
    const end = l.boxes.find((x) => x.id === 'end')!
    expect(end.y).toBeGreaterThan(b.y)
  })

  it('간선마다 경로가 하나씩 나온다', () => {
    const l = layoutFlow([n('a', ['b'], 'start'), n('b', [], 'success')])
    expect(l.edges).toHaveLength(1)
    expect(l.edges[0]).toMatchObject({ fromId: 'a', toId: 'b' })
    expect(l.edges[0].d.startsWith('M')).toBe(true)
  })

  it('없는 노드를 가리키는 간선은 버린다 — 화면이 죽지 않아야 한다', () => {
    const l = layoutFlow([n('a', ['ghost'], 'start')])
    expect(l.edges).toHaveLength(0)
    expect(l.boxes).toHaveLength(1)
  })

  it('빈 흐름은 빈 배치', () => {
    const l = layoutFlow([])
    expect(l.boxes).toEqual([])
    expect(l.width).toBe(0)
    expect(l.height).toBe(0)
  })

  it('크기는 상자를 모두 담는다', () => {
    const l = layoutFlow([n('a', ['b'], 'start'), n('b', [], 'success')])
    for (const b of l.boxes) {
      expect(b.x + NODE_W).toBeLessThanOrEqual(l.width)
      expect(b.y + NODE_H).toBeLessThanOrEqual(l.height)
    }
  })
})

describe('layoutAreas', () => {
  const area = (id: string, ...hs: number[]): AreaInput => ({ id, items: hs.map((h, i) => ({ id: `${id}/${i}`, h })) })

  it('packs groups into as many columns as the width holds, each next one into the shortest column', () => {
    const l = layoutAreas([area('a', 100, 100), area('b', 40), area('c', 40)], { width: 500, colW: 200, gap: 16, headH: 20, pad: 8 })
    const [a, b, c] = l.groups
    expect(a.x).toBe(0)
    expect(b.x).toBe(216)
    // b's column is the shorter one, so c stacks under b
    expect(c.x).toBe(216)
    expect(c.y).toBe(b.y + b.h + 16)
    expect(l.width).toBe(416)
  })

  it('stacks items inside a group under its label row, inset by the padding', () => {
    const l = layoutAreas([area('a', 30, 50)], { width: 300, colW: 200, gap: 16, headH: 20, pad: 8 })
    const [one, two] = l.boxes
    expect(one).toEqual({ id: 'a/0', x: 8, y: 20, w: 184, h: 30 })
    expect(two.y).toBe(20 + 30 + 8)
    expect(l.groups[0].h).toBe(20 + 30 + 8 + 50 + 8)
    expect(l.height).toBe(l.groups[0].h)
  })

  it('keeps one column when the width is narrower than a column', () => {
    const l = layoutAreas([area('a', 10), area('b', 10)], { width: 50, colW: 200 })
    expect(new Set(l.groups.map((g) => g.x))).toEqual(new Set([0]))
  })
})

describe('linkPath', () => {
  const box = (x: number, y: number): AreaBox => ({ id: `${x}:${y}`, x, y, w: 100, h: 40 })

  it('runs from the right edge to the left edge when the target is in a column to the right', () => {
    expect(linkPath(box(0, 0), box(200, 100))).toMatch(/^M100 20 C.* 200 120$/)
  })

  it('runs from the left edge when the target is to the left', () => {
    expect(linkPath(box(200, 0), box(0, 0))).toMatch(/^M200 20 C.* 100 20$/)
  })

  it('loops out of the right edge when both are in one column', () => {
    expect(linkPath(box(0, 0), box(0, 100), 28)).toBe('M100 20 C128 20 128 120 100 120')
  })
})
