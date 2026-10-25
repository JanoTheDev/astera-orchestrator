import { describe, expect, it, vi } from 'vitest'
import { itemEntriesOf, itemMenuOf, needTextOf, runItemAction, type ItemDeps, type ItemRef } from './itemMenu'
import { lineTargetOf, openTargetOf } from './inboxNav'
import { t as translate } from '../../../../core/i18n'
import type { NeedCard } from './inboxView'

const t = ((k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate('en', k, p)) as never
const ids = (r: Pick<ItemRef, 'key' | 'target' | 'sessionId'>, read = false): string[] => itemEntriesOf(r, read).map((e) => e.id)
const deps = (): ItemDeps => ({ open: vi.fn(), console: vi.fn(), setRead: vi.fn(), copy: vi.fn() })

describe('itemEntriesOf', () => {
  it('an item with a jobId only opens its plan, with no console entry', () => {
    expect(ids({ key: 'e1', target: lineTargetOf({ jobId: 'j1' }) })).toEqual(['open', 'read', 'copy'])
  })
  it('an item with a jobId and a session offers the plan and the console', () => {
    expect(ids({ key: 'e1', target: lineTargetOf({ jobId: 'j1', sessionId: 's1' }), sessionId: 's1' })).toEqual(['open', 'console', 'read', 'copy'])
  })
  it('a console target is not listed twice', () => {
    expect(ids({ key: 'e1', target: lineTargetOf({ sessionId: 's1' }), sessionId: 's1' })).toEqual(['open', 'read', 'copy'])
  })
  it('a read item offers Mark unread, an unread one Mark read', () => {
    expect(ids({ key: 'k', target: null }, true)).toEqual(['unread', 'copy'])
    expect(ids({ key: 'k', target: null }, false)).toEqual(['read', 'copy'])
  })
  it('a list without read state (Activity) has no read entry', () => {
    expect(ids({ target: lineTargetOf({ jobId: 'j1' }) })).toEqual(['open', 'copy'])
  })
})

describe('runItemAction', () => {
  const ref: ItemRef = { key: 'k', target: { kind: 'plan', jobId: 'j1', tab: 'x' }, sessionId: 's1', text: 'hello' }
  it('routes each action to its dependency', () => {
    const d = deps()
    runItemAction('open', ref, d)
    runItemAction('console', ref, d)
    runItemAction('read', ref, d)
    runItemAction('unread', ref, d)
    runItemAction('copy', ref, d)
    expect(d.open).toHaveBeenCalledWith(ref.target)
    expect(d.console).toHaveBeenCalledWith('s1')
    expect(d.setRead).toHaveBeenNthCalledWith(1, 'k', true)
    expect(d.setRead).toHaveBeenNthCalledWith(2, 'k', false)
    expect(d.copy).toHaveBeenCalledWith('hello')
  })
  it('menu rows carry the English labels and run on select', () => {
    const d = deps()
    const rows = itemMenuOf(ref, true, d, t)
    expect(rows.map((r) => r.label)).toEqual(['Open plan', 'Open its console', 'Mark unread', 'Copy text'])
    rows[2]!.onSelect()
    expect(d.setRead).toHaveBeenCalledWith('k', false)
  })
})

describe('needTextOf', () => {
  it('names kind and place, then the question', () => {
    const c: NeedCard = { key: 'k', kind: 'question', at: null, jobId: 'j1', projectName: 'p', planName: 'L4', q: { question: 'Which branch?' } as never }
    expect(needTextOf(c, t)).toBe('Question · p › L4\nWhich branch?')
    expect(openTargetOf(c).kind).toBe('plan')
  })
})
