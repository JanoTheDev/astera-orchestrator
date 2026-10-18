import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  blameLinesOf,
  breakdownOf,
  lastDeliveryOf,
  lineKindOf,
  markerOf,
  percentAi,
  statsOf,
  type BlameLine
} from './attribution'
import { ChipMarker } from './blameGutter'
import { BlameDetails } from './BlameDetails'
import { TaskLinesView } from './TaskLines'
import { ProjectAttributionView } from './ProjectAttribution'

const note = { agent: 'claude', model: 'opus', account: 'work', job: 'job_1', task: 'tsk_1', session: 'ses_1', lines: { 'f.ts': [[1, 5]] as [number, number][] } }

describe('lineKindOf', () => {
  it('no note unknown, human note human, no lines all AI, else by range', () => {
    expect(lineKindOf(null, 'f.ts', 1)).toBe('unknown')
    expect(lineKindOf({ human: true }, 'f.ts', 1)).toBe('human')
    expect(lineKindOf({}, 'f.ts', 9)).toBe('ai')
    expect(lineKindOf(note, 'f.ts', 5)).toBe('ai')
    expect(lineKindOf(note, 'f.ts', 6)).toBe('human')
  })
})

describe('blameLinesOf', () => {
  it('reads a row kind, or resolves it from the note and the line in that commit; skips bad rows', () => {
    const rows = blameLinesOf(
      {
        lines: [
          { line: 1, kind: 'human', sha: 'abc' },
          { line: 2, origLine: 4, note },
          { line: 3, origLine: 7, note },
          { line: 4, note: null },
          { nope: true }
        ]
      },
      'f.ts'
    )
    expect(rows.map((r) => [r.line, r.kind])).toEqual([
      [1, 'human'],
      [2, 'ai'],
      [3, 'human'],
      [4, 'unknown']
    ])
    expect(rows[1]).toMatchObject({ agent: 'claude', model: 'opus', task: 'tsk_1', session: 'ses_1' })
  })
})

describe('gutter states', () => {
  it('each state has its own text, so colour is never the only signal, and a label for screen readers', () => {
    const ai = markerOf({ line: 3, kind: 'ai', agent: 'claude', model: 'opus', task: 'tsk_1' })
    const human = markerOf({ line: 4, kind: 'human' })
    const unknown = markerOf({ line: 5, kind: 'unknown' })
    expect([ai.text, human.text, unknown.text]).toEqual(['AI', 'H', '?'])
    expect(ai.label).toBe('Line 3: AI, claude/opus, Task tsk_1. Open for the Task and session.')
    expect(human.label).toContain('human')
    expect(unknown.label).toContain('unknown')
    expect(new Set([ai.className, human.className, unknown.className]).size).toBe(3)
  })
})

describe('keyboard path', () => {
  const realDocument = (globalThis as { document?: unknown }).document
  afterEach(() => {
    ;(globalThis as { document?: unknown }).document = realDocument
  })
  it('a chip is a <button> with its label (Tab reaches it; Enter and Space click it) and the click picks the line', () => {
    const made: Record<string, unknown>[] = []
    ;(globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => {
        const el: Record<string, unknown> = { tag, attrs: {} as Record<string, string>, listeners: {} as Record<string, () => void> }
        el.setAttribute = (k: string, v: string) => ((el.attrs as Record<string, string>)[k] = v)
        el.addEventListener = (k: string, f: () => void) => ((el.listeners as Record<string, () => void>)[k] = f)
        made.push(el)
        return el
      }
    }
    const l: BlameLine = { line: 2, kind: 'ai', task: 'tsk_1' }
    let picked: BlameLine | null = null
    new ChipMarker(l, (x) => (picked = x)).toDOM()
    const b = made[0] as { tag: string; type: string; textContent: string; attrs: Record<string, string>; listeners: Record<string, () => void> }
    expect(b.tag).toBe('button')
    expect(b.type).toBe('button')
    expect(b.textContent).toBe('AI')
    expect(b.attrs['aria-label']).toBe(markerOf(l).label)
    b.listeners.click()
    expect(picked).toBe(l)
  })

  it('the details open on the Task first, then the session', () => {
    const l: BlameLine = { line: 2, kind: 'ai', agent: 'claude', model: 'opus', account: 'work', job: 'job_1', task: 'tsk_1', session: 'ses_1' }
    const task = renderToStaticMarkup(React.createElement(BlameDetails, { line: l, onClose: () => {} }))
    expect(task).toContain('role="dialog"')
    expect(task).toContain('tsk_1')
    expect(task).toContain('Show session')
    expect(task).not.toContain('ses_1')
    const session = renderToStaticMarkup(React.createElement(BlameDetails, { line: l, initialStep: 'session', onClose: () => {} }))
    expect(session).toContain('ses_1')
    expect(session).toContain('claude / opus')
    const human = renderToStaticMarkup(React.createElement(BlameDetails, { line: { line: 1, kind: 'human', sha: 'abcdef1234' }, onClose: () => {} }))
    expect(human).toContain('Written by a person in abcdef12')
  })
})

const stats = statsOf({
  human_additions: 25,
  ai_additions: 75,
  ai_accepted: 70,
  git_diff_added_lines: 100,
  git_diff_deleted_lines: 3,
  tool_model_breakdown: { 'claude::opus': { ai_additions: 50 }, 'codex::gpt': { ai_additions: 25 } }
})

describe('stats', () => {
  it('reads git-ai named stats, % AI and the breakdown', () => {
    expect(stats).not.toBeNull()
    expect(percentAi(stats!)).toBe(75)
    expect(breakdownOf(stats!)).toEqual([
      { name: 'claude / opus', lines: 50, percent: 50 },
      { name: 'codex / gpt', lines: 25, percent: 25 }
    ])
    expect(statsOf({ error: 'unknown command' })).toBeNull()
    expect(percentAi({ ai_additions: 0, human_additions: 0 })).toBeNull()
  })
  it('the last delivery is the newest pushed commit', () => {
    expect(lastDeliveryOf([{ delivery: { at: '2026-10-01', sha: 'a' } }, { delivery: { at: '2026-10-02', sha: 'b' } }, { pr: {} }])).toBe('b')
    expect(lastDeliveryOf([{ delivery: { at: '2026-10-01', error: 'x' } }])).toBeUndefined()
  })
  it('the plan card shows AI and human lines, with a text for screen readers; nothing with no lines', () => {
    const html = renderToStaticMarkup(React.createElement('dl', null, React.createElement(TaskLinesView, { stats })))
    expect(html).toContain('75 AI lines, 25 human lines')
    expect(renderToStaticMarkup(React.createElement(TaskLinesView, { stats: null }))).toBe('')
  })
  it('the project page shows % AI by agent and model, for the last delivery and all time', () => {
    const html = renderToStaticMarkup(React.createElement(ProjectAttributionView, { all: stats, last: undefined }))
    expect(html).toContain('No push delivery yet.')
    expect(html).toContain('75% AI')
    expect(html).toContain('claude / opus: 50 lines (50%)')
    expect(html).toContain('human: 25 lines (25%)')
  })
})
