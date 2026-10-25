// T9: the bell (NotificationBell.tsx), its Popover's keys (ui/Popover.tsx) and the status bar's "needs you" opening it.
// The suite is node-only: components are rendered to markup, and their handlers are found on the element tree.
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { t as translate } from '../../../../core/i18n'
import type { HandledLine, NeedCard } from '../inbox/inboxView'
import { popoverKeyDown } from '../ui/Popover'
import { registerNavigation, type NavigationHandlers } from './navigation'
import { BellPanel, bellOpen, setBellOpen, viewAllInbox } from './NotificationBell'
import { StatusBar, type StatusBarProps } from './StatusBar'

const t = ((k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate('en', k, p)) as never

/** Every element in a tree, depth first (components are not called: their props are what is checked). */
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  const el = node as React.ReactElement<Record<string, unknown>>
  return [el, ...elements(el.props.children as React.ReactNode)]
}
const text = (node: React.ReactNode): string => renderToStaticMarkup(React.createElement(React.Fragment, null, node))

const card = (over: Partial<NeedCard>): NeedCard => ({ key: 'k', kind: 'approval', at: '2026-10-18T09:00:00Z', jobId: 'j1', projectName: 'gameful', planName: 'L4', ...over })
const line: HandledLine = { id: 'e1', at: '2026-10-18T09:00:00Z', text: 'T3 delivered', who: '', tone: 'ok', plan: 'L4', sessionId: 's1', jobId: 'j1' }

const panel = (over: Partial<React.ComponentProps<typeof BellPanel>> = {}): React.ComponentProps<typeof BellPanel> => ({
  needs: [card({ key: 'a' }), card({ key: 'q', kind: 'question' }), card({ key: 'p', kind: 'permission', sessionId: 's2' })],
  recent: [line],
  read: new Set(['q']),
  nowMs: Date.parse('2026-10-18T09:12:00Z'),
  t,
  onMarkAllRead: vi.fn(),
  onAct: vi.fn(),
  onLine: vi.fn(),
  onOpen: vi.fn(),
  onToggleRead: vi.fn(),
  onMenu: vi.fn(),
  menu: null,
  onMenuClose: vi.fn(),
  onViewAll: vi.fn(),
  ...over
})

afterEach(() => setBellOpen(false))

describe('BellPanel', () => {
  it('lists "Needs you" with one action each, then "Recent", then View all', () => {
    const html = renderToStaticMarkup(React.createElement(BellPanel, panel()))
    expect(html).toContain('Notifications')
    expect(html).toContain('Mark all read')
    expect(html.indexOf('Needs you')).toBeLessThan(html.indexOf('Recent'))
    for (const word of ['Approve', 'Answer', 'Open', 'T3 delivered', 'View all']) expect(html).toContain(word)
    // unread cards are marked, a read one is not
    expect(html.match(/bell__item--unread/g)).toHaveLength(2)
  })

  it('shows the All projects toggle only when it is offered, pressed when on', () => {
    expect(renderToStaticMarkup(React.createElement(BellPanel, panel()))).not.toContain('All projects')
    const on = renderToStaticMarkup(React.createElement(BellPanel, panel({ allProjects: { on: true, toggle: () => {} } })))
    expect(on).toContain('All projects')
    expect(on).toContain('aria-pressed="true"')
  })

  it('an empty bell says nothing needs you', () => {
    expect(renderToStaticMarkup(React.createElement(BellPanel, panel({ needs: [], recent: [] })))).toContain('Nothing needs you right now.')
  })

  it('every control is a roving row, and View all calls onViewAll', () => {
    const p = panel()
    const tree = elements(BellPanel(p))
    const rows = tree.filter((el) => el.props['data-roving'] === '')
    // toggle absent: Mark all read + three cards (Open, read toggle, action) + one line + View all
    expect(rows).toHaveLength(12)
    const viewAll = rows.find((el) => text(el.props.children as React.ReactNode) === 'View all')
    ;(viewAll?.props.onClick as () => void)()
    expect(p.onViewAll).toHaveBeenCalled()
  })
})

describe('BellPanel item actions', () => {
  it('a card offers Open and Mark read/unread beside its action', () => {
    const p = panel()
    const tree = elements(BellPanel(p))
    const byLabel = (l: string) => tree.filter((el) => el.props.label === l)
    ;(byLabel('Open')[0]!.props.onClick as () => void)()
    expect(p.onOpen).toHaveBeenCalledWith(p.needs[0])
    expect(byLabel('Mark read')).toHaveLength(2)
    expect(byLabel('Mark unread')).toHaveLength(1)
    ;(byLabel('Mark unread')[0]!.props.onClick as () => void)()
    expect(p.onToggleRead).toHaveBeenCalledWith('q', true)
  })
  it('a Recent line with only a jobId is enabled, one with nothing is not', () => {
    const rows = (l: HandledLine) => elements(BellPanel(panel({ recent: [l] }))).filter((el) => el.props.className === 'bell__line')
    expect(rows({ ...line, sessionId: undefined })[0]!.props.disabled).toBe(false)
    expect(rows({ ...line, sessionId: undefined, jobId: undefined })[0]!.props.disabled).toBe(true)
  })
})

describe('the bell opens and closes', () => {
  it('"View all" opens the full Inbox and shuts the popover', () => {
    const handlers = { openInbox: vi.fn() } as unknown as NavigationHandlers
    const off = registerNavigation(handlers)
    setBellOpen(true)
    viewAllInbox()
    expect(handlers.openInbox).toHaveBeenCalledWith(undefined)
    expect(bellOpen()).toBe(false)
    off()
  })

  it('the status bar’s "needs you" opens the panel’s Needs you tab (DESIGN-W13 §7)', () => {
    const props = { t, counts: { consoles: 1, working: 0, waiting: 3 }, needsYouUnread: 3, nextQueued: null, hostStatus: null, workspaceTree: [], workspaceProjectId: null, currentProject: null, branch: null } as unknown as StatusBarProps
    const needsYou = elements(StatusBar(props)).find((el) => el.props.tone === 'warn' && typeof el.props.onClick === 'function')
    expect(needsYou).toBeDefined()
    const handlers = { openPanel: vi.fn() } as unknown as NavigationHandlers
    const off = registerNavigation(handlers)
    ;(needsYou!.props.onClick as () => void)()
    expect(handlers.openPanel).toHaveBeenCalledWith('needs')
    off()
  })
})

describe('the popover’s keys', () => {
  const rows = () => [{ focus: vi.fn<() => void>() }, { focus: vi.fn<() => void>() }, { focus: vi.fn<() => void>() }]

  it('arrows move over the rows and wrap; Home and End jump', () => {
    const items = rows()
    const close = vi.fn()
    expect(popoverKeyDown('ArrowDown', items, -1, close, null)).toBe(true)
    expect(items[0]!.focus).toHaveBeenCalled()
    popoverKeyDown('ArrowDown', items, 2, close, null)
    expect(items[0]!.focus).toHaveBeenCalledTimes(2)
    popoverKeyDown('ArrowUp', items, 0, close, null)
    expect(items[2]!.focus).toHaveBeenCalled()
    popoverKeyDown('End', items, 0, close, null)
    expect(items[2]!.focus).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
  })

  it('Esc closes and gives focus back to the button; other keys are left alone', () => {
    const trigger = { focus: vi.fn() }
    const close = vi.fn()
    expect(popoverKeyDown('Escape', rows(), 1, close, trigger)).toBe(true)
    expect(close).toHaveBeenCalled()
    expect(trigger.focus).toHaveBeenCalled()
    expect(popoverKeyDown('Enter', rows(), 1, vi.fn(), trigger)).toBe(false)
  })
})
