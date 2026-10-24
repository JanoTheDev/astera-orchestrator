import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Inbox } from 'lucide-react'
import {
  Badge, Button, Card, Checkbox, Chip, ConfirmDialog, EmptyState, Field, Icon, ICONS, Input, itemsOfOptions, Kbd, kbdKeys, Menu, Meter, Modal, PageHeader, Popover,
  Section, Select, Skeleton, Switch, Tabs, Textarea, Toast, ToastViewport,
  ActivityBarItem, EditorTab, Sash, StatusBarItem, Toolbar, Tree, TreeRow, ViewContainer, ViewPane
} from './index'
import type { NativeSelectProps } from './index'
import { UpdateGate } from '../UpdateGate'

// createElement types against Select's last (list) signature; the native form is what JSX callers pick by their props
const NativeSelect = Select as (p: NativeSelectProps) => React.JSX.Element

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

const html = (el: React.ReactElement): string => renderToStaticMarkup(el)

describe('ui primitives render', () => {
  it('a loading Button shows the spinner in place of the icon, is busy and disabled', () => {
    const out = html(React.createElement(Button, { loading: true, icon: React.createElement('i', { id: 'ico' }) }, 'Save'))
    expect(out).toContain('ui-spin')
    expect(out).not.toContain('id="ico"')
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('disabled')
    expect(out).toContain('ui-btn--secondary')
  })

  it('an icon-only Button is a ghost icon button', () => {
    expect(html(React.createElement(Button, { icon: 'x', 'aria-label': 'Close' }))).toMatch(/ui-btn--ghost.*ui-btn--icon/)
  })

  it('Chip draws its dot only when asked', () => {
    expect(html(React.createElement(Chip, { tone: 'ok', dot: true, children: 'done' }))).toContain('ui-chip__dot')
    expect(html(React.createElement(Chip, { children: 'n' }))).not.toContain('ui-chip__dot')
  })

  it('a clickable Card is a <button>, a plain one a <div>', () => {
    expect(html(React.createElement(Card, { onClick: () => {}, children: 'x' }))).toMatch(/^<button type="button"/)
    expect(html(React.createElement(Card, { tone: 'need', children: 'x' }))).toMatch(/^<div class="ui-card ui-card--need"/)
  })

  it('Meter is a meter with its rounded, clamped value', () => {
    const out = html(React.createElement(Meter, { value: 92.4, label: 'Usage' }))
    expect(out).toContain('role="meter"')
    expect(out).toContain('aria-valuenow="92"')
    expect(out).toContain('ui-meter--danger')
    expect(html(React.createElement(Meter, { value: 130 }))).toContain('aria-valuenow="100"')
  })

  it('Tabs mark the selected tab', () => {
    const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', count: 2 }]
    const tabs = html(React.createElement(Tabs, { items, value: 'a', onChange: () => {} }))
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>A/)
  })

  it('Field ties hint and error to the control', () => {
    const out = html(React.createElement(Field, { id: 'f', label: 'Name', hint: 'h', error: 'e' }))
    expect(out).toContain('aria-describedby="f-hint f-error"')
    expect(out).toContain('aria-invalid="true"')
    expect(out).toContain('for="f"')
  })

  it('Section reads closed state from nowhere without crashing (no localStorage in node)', () => {
    expect(html(React.createElement(Section, { id: 's', label: 'L', count: 3, children: 'body' }))).toContain('aria-expanded="true"')
  })

  it('Icon is hidden unless labelled; EmptyState carries its line', () => {
    expect(html(React.createElement(Icon, { icon: Inbox }))).toContain('aria-hidden="true"')
    expect(html(React.createElement(Icon, { icon: Inbox, label: 'Inbox' }))).toContain('aria-label="Inbox"')
    expect(html(React.createElement(EmptyState, { icon: Inbox, children: 'Nothing here' }))).toContain('Nothing here')
  })
})

describe('W11 primitives', () => {
  it('Button has an lg size', () => {
    expect(html(React.createElement(Button, { variant: 'primary', size: 'lg' }, 'Go'))).toContain('ui-btn--primary ui-btn--lg')
  })

  it('Input, Select and Textarea carry their house class next to the caller\'s', () => {
    expect(html(React.createElement(Input, { className: 'x', placeholder: 'p' }))).toMatch(/^<input type="text" class="ui-input x"/)
    expect(html(React.createElement(NativeSelect, { value: 'a', children: React.createElement('option', { value: 'a' }, 'A') }))).toMatch(/^<div class="sel"[^>]*><button[^>]*role="combobox"/)
    expect(html(React.createElement(Textarea, { rows: 3 }))).toMatch(/^<textarea class="ui-textarea"/)
  })

  it('Field renders the house controls', () => {
    expect(html(React.createElement(Field, { label: 'N' }))).toContain('class="ui-input"')
    expect(html(React.createElement(Field, { label: 'N', kind: 'select', options: [{ value: 'a', label: 'A' }] }))).toContain('class="sel-trigger"')
    expect(html(React.createElement(Field, { label: 'N', kind: 'textarea' }))).toContain('class="ui-textarea"')
  })

  it('Badge is a toned pill that renders its child as given (zero too)', () => {
    expect(html(React.createElement(Badge, { tone: 'warn', children: 0 }))).toBe('<span class="ui-badge ui-badge--warn">0</span>')
  })

  it('Kbd gives every key its own cap and keeps a literal plus', () => {
    expect(kbdKeys('Ctrl+Alt+N')).toEqual(['Ctrl', 'Alt', 'N'])
    expect(kbdKeys('Ctrl++')).toEqual(['Ctrl', '+'])
    expect(kbdKeys('+')).toEqual(['+'])
    expect(html(React.createElement(Kbd, { children: 'Ctrl+K' }))).toBe('<span class="ui-kbd"><kbd>Ctrl</kbd><kbd>K</kbd></span>')
  })

  it('PageHeader: title is the h1; subtitle, leading, actions and filters only when given', () => {
    const bare = html(React.createElement(PageHeader, { title: 'Plans' }))
    expect(bare).toContain('<h1 class="ui-page-header__title">Plans</h1>')
    expect(bare).not.toMatch(/__subtitle|__actions|__filters|__leading/)
    const full = html(React.createElement(PageHeader, { title: 'Plans', subtitle: '3 open', leading: 'L', actions: 'A', filters: 'F' }))
    expect(full).toMatch(/__leading">L<.*__title">Plans<.*__subtitle">3 open<.*__actions">A<.*__filters">F</)
  })

  it('EmptyState: headline above the sentence, icon in its circle; the old children-only call still renders', () => {
    const out = html(React.createElement(EmptyState, { icon: Inbox, title: 'No consoles yet', action: 'act', children: 'Start one.' }))
    expect(out).toMatch(/ui-empty__icon.*ui-empty__title">No consoles yet<.*ui-empty__text">Start one.<.*ui-empty__action">act</)
    expect(html(React.createElement(EmptyState, { children: 'x' }))).toBe('<div class="ui-empty"><p class="ui-empty__text">x</p></div>')
  })

  it('Tabs: underline is the default, strip its old name, segmented as before', () => {
    const items = [{ id: 'a', label: 'A' }]
    const of = (variant?: 'underline' | 'strip' | 'segmented'): string => html(React.createElement(Tabs, { items, value: 'a', onChange: () => {}, variant }))
    expect(of()).toContain('ui-tabs--underline')
    expect(of('strip')).toContain('ui-tabs--underline')
    expect(of('segmented')).toContain('ui-tabs--segmented')
  })

  it('Menu renders closed: just its trigger', () => {
    const out = html(React.createElement(Menu, { label: 'More', items: ['separator', { id: 'a', label: 'A', onSelect: () => {}, shortcut: 'Ctrl+A', checked: true }] }))
    expect(out).toContain('aria-haspopup="menu"')
    expect(out).not.toContain('role="menu"')
  })
})

describe('T7 primitives', () => {
  const items = [
    { value: 'a', label: 'Apple' },
    { value: 'b', label: 'Banana', disabled: true }
  ]

  it('Select is a select-only combobox: closed, it names its value and owns no list yet', () => {
    const out = html(React.createElement(Select, { items, value: 'a', onChange: () => {}, ariaLabel: 'Fruit' }))
    expect(out).toContain('role="combobox"')
    expect(out).toContain('aria-haspopup="listbox"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('aria-label="Fruit"')
    expect(out).not.toContain('aria-activedescendant')
    expect(out).toContain('>Apple<')
    expect(out).not.toContain('role="listbox"')
  })

  it('Select shows the placeholder when nothing matches, and takes an id for a <label for>', () => {
    const out = html(React.createElement(Select, { items, value: 'zz', onChange: () => {}, placeholder: 'Pick one', id: 'f1' }))
    expect(out).toContain('sel-value empty">Pick one<')
    expect(out).toContain('id="f1"')
  })

  it('the native form reads <option>/<optgroup> children, disabled options too', () => {
    const kids = [
      React.createElement('option', { key: 1, value: 'all' }, 'All'),
      React.createElement('optgroup', { key: 2, label: 'Proj' }, React.createElement('option', { value: 'p1', disabled: true }, 'Plan ', 1))
    ]
    expect(itemsOfOptions(kids)).toEqual([
      { value: 'all', label: 'All', group: undefined, disabled: undefined },
      { value: 'p1', label: 'Plan 1', group: 'Proj', disabled: true }
    ])
    expect(html(React.createElement(NativeSelect, { value: 'all', onChange: () => {}, children: kids }))).toContain('>All<')
  })

  it('a context Menu renders open at its point, rows are menuitems, disabled ones disabled', () => {
    const out = html(
      React.createElement(Menu, {
        at: { x: 10, y: 20 },
        onClose: () => {},
        items: [{ label: 'Rename', onSelect: () => {} }, 'separator', { label: 'Delete', onSelect: () => {}, danger: true, disabled: true }]
      })
    )
    expect(out).toContain('role="menu"')
    expect(out).toContain('ui-menu__list--context')
    expect(out).toContain('left:10px;top:20px')
    expect(out.match(/role="menuitem"/g)).toHaveLength(2)
    expect(out).toContain('role="separator"')
    expect(out).toMatch(/disabled=""[^>]*ui-menu__item--danger|ui-menu__item--danger[^>]*disabled=""/)
  })

  it('Toast: kind class, icon, message, action button and a named close button', () => {
    const out = html(
      React.createElement(Toast, {
        toast: { id: 1, kind: 'error', message: 'Save failed', action: { label: 'Retry', onClick: () => {} } },
        dismissLabel: 'Dismiss',
        onDismiss: () => {}
      })
    )
    expect(out).toContain('ui-toast--error')
    expect(out).toContain('ui-toast__icon')
    expect(out).toContain('Save failed')
    expect(out).toMatch(/ui-btn--primary[^>]*>.*Retry/)
    expect(out).toContain('aria-label="Dismiss"')
  })

  it('ToastViewport is a polite live region', () => {
    const out = html(React.createElement(ToastViewport))
    expect(out).toContain('role="status"')
    expect(out).toContain('aria-live="polite"')
  })

  it('Switch is a role=switch checkbox reflecting checked', () => {
    const out = html(React.createElement(Switch, { checked: true, onChange: () => {}, 'aria-label': 'Auto' }))
    expect(out).toMatch(/^<input type="checkbox" role="switch" class="ui-toggle"/)
    expect(out).toContain('checked=""')
    expect(html(React.createElement(Field, { kind: 'toggle', label: 'T', checked: false, onChange: () => {} }))).toContain('role="switch"')
  })

  it('Checkbox is a native checkbox reflecting checked, wrapped when labelled', () => {
    const out = html(React.createElement(Checkbox, { checked: true, onChange: () => {}, 'aria-label': 'Pick' }))
    expect(out).toMatch(/^<input type="checkbox" class="ui-check"/)
    expect(out).toContain('checked=""')
    expect(html(React.createElement(Checkbox, { checked: false, onChange: () => {}, label: 'Draft' }))).toMatch(/^<label class="check-small"><input[^>]*\/>Draft<\/label>$/)
  })

  it('Skeleton is hidden from readers and sized by props', () => {
    const out = html(React.createElement(Skeleton, { shape: 'circle', width: 32, height: 32 }))
    expect(out).toBe('<span aria-hidden="true" class="ui-skeleton ui-skeleton--circle" style="width:32px;height:32px"></span>')
  })

  it('ConfirmDialog sits on Modal; danger draws the danger confirm after cancel', () => {
    const out = html(React.createElement(ConfirmDialog, { title: 'Delete?', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true, onConfirm: () => {}, onCancel: () => {}, children: 'Gone for good' }))
    expect(out).toContain('role="dialog"')
    expect(out).toContain('Gone for good')
    expect(out).toMatch(/Keep<.*ui-btn--danger[^>]*>.*Delete</)
    expect(html(React.createElement(ConfirmDialog, { title: 'Go?', confirmLabel: 'Go', cancelLabel: 'No', onConfirm: () => {}, onCancel: () => {} }))).toContain('ui-btn--primary')
  })

  it('Icon by registry name, at 14 or 16', () => {
    expect(html(React.createElement(Icon, { name: 'delete', size: 14 }))).toMatch(/^<svg[^>]*width="14"[^>]*aria-hidden="true"/)
    expect(html(React.createElement(Icon, { name: 'search', label: 'Search' }))).toMatch(/width="16"[^>]*role="img"[^>]*aria-label="Search"|aria-label="Search"[^>]*width="16"|width="16".*aria-label="Search"/)
    expect(Object.keys(ICONS).length).toBeGreaterThan(20)
  })

  it('Popover renders closed: its trigger only', () => {
    const out = html(
      React.createElement(Popover, {
        open: false,
        onOpenChange: () => {},
        label: 'Usage',
        trigger: (p: { 'aria-haspopup': 'dialog'; 'aria-expanded': boolean }) =>
          React.createElement('button', { 'aria-haspopup': p['aria-haspopup'], 'aria-expanded': p['aria-expanded'] }, 'U'),
        children: 'panel'
      })
    )
    expect(out).toContain('aria-haspopup="dialog"')
    expect(out).not.toContain('panel')
  })
})

describe('primitives.css', () => {
  it('uses tokens only: no colour literals', () => {
    const css = readFileSync(new URL('../../styles/primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })

  it('no raw px font sizes or shadows: sizes and shadows come from tokens', () => {
    const css = readFileSync(new URL('../../styles/primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/)
    expect(css).not.toMatch(/box-shadow:[^;]*\d+px\s+[\d.]+px/)
  })
})

describe('workbench primitives (DESIGN-W13)', () => {
  const rows = [
    { id: 'src', depth: 0, label: 'src', hasChildren: true, expanded: true },
    { id: 'a', depth: 1, label: 'a.ts', description: 'lib', decoration: { text: 'M', tone: 'warn' as const }, actions: React.createElement('i', { id: 'act' }) }
  ]

  it('Tree is an ARIA tree of treeitems with level, expanded and selected', () => {
    const out = html(React.createElement(Tree, { rows, selectedId: 'a', label: 'Files' }))
    expect(out).toContain('role="tree"')
    expect(out).toContain('aria-label="Files"')
    expect(out.match(/role="treeitem"/g)).toHaveLength(2)
    expect(out).toMatch(/aria-level="1"[^>]*aria-selected="false"[^>]*aria-expanded="true"/)
    expect(out).toMatch(/aria-level="2"[^>]*aria-selected="true"/)
    expect(out).toContain('ui-tree__indent')
    expect(out).toContain('ui-tree__deco--warn')
    expect(out).toContain('ui-tree__meta has-actions')
    expect(out).toContain('aria-activedescendant')
  })

  it('Tree draws only the viewport past 200 rows', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, depth: 0, label: `row ${i}` }))
    const out = html(React.createElement(Tree, { rows: many, label: 'Big' }))
    const drawn = out.match(/role="treeitem"/g)?.length ?? 0
    expect(drawn).toBeGreaterThan(10)
    expect(drawn).toBeLessThan(60)
    expect(out).toContain(`height:${5000 * 22}px`)
    expect(out).not.toContain('row 4000')
  })

  it('a TreeRow without children has no aria-expanded and no chevron', () => {
    const out = html(React.createElement(TreeRow, { row: { id: 'x', depth: 0, label: 'x' } }))
    expect(out).not.toContain('aria-expanded')
    expect(out).not.toContain('<svg')
  })

  it('ViewPane: a pane without a saved size keeps its CSS sizing while its siblings have saved sizes', () => {
    const saved = new Map([['cm.section.b.size', '300'], ['cm.section.c.size', '200']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: () => undefined })
    try {
      const pane = (k: string): React.ReactElement => React.createElement(ViewPane, { key: k, title: k, storageKey: k, children: 'x' })
      const out = html(React.createElement(ViewContainer, null, ['a', 'b', 'c'].map(pane)))
      expect(out).toContain('style="flex:300 1 0;max-height:none"')
      expect(out.match(/<section[^>]*data-pane="a"[^>]*>/)?.[0]).not.toContain('style=')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ViewPane: a toggle with aria-expanded, uppercase title, count; body only when open', () => {
    const open = html(React.createElement(ViewContainer, null, React.createElement(ViewPane, { title: 'Open editors', count: 3, children: 'body' })))
    expect(open).toContain('ui-viewcontainer')
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('ui-badge')
    expect(open).toContain('body')
    const closed = html(React.createElement(ViewPane, { title: 'T', defaultExpanded: false, storageKey: 'x', children: 'body' }))
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('body<')
  })

  it('Sash is a focusable separator with its value and range', () => {
    const out = html(React.createElement(Sash, { orientation: 'vertical', size: 260.4, min: 170, max: 600, onResize: () => {}, label: 'Resize' }))
    expect(out).toContain('role="separator"')
    expect(out).toContain('aria-orientation="vertical"')
    expect(out).toContain('aria-valuenow="260"')
    expect(out).toContain('aria-valuemin="170"')
    expect(out).toContain('tabindex="0"')
  })

  it('Toolbar: one Tab stop (the first enabled button), an overflow trigger when asked', () => {
    const items = [
      { id: 'a', icon: 'a', label: 'A', onClick: () => {}, disabled: true },
      { id: 'b', icon: 'b', label: 'B', onClick: () => {} }
    ]
    const out = html(React.createElement(Toolbar, { items, label: 'Actions', overflow: [{ label: 'More', onSelect: () => {} }], overflowLabel: 'More actions' }))
    expect(out).toContain('role="toolbar"')
    expect(out.match(/tabindex="0"/g)).toHaveLength(1)
    expect(out).toMatch(/aria-label="B"[^>]*tabindex="0"|tabindex="0"[^>]*aria-label="B"/)
    expect(out).toContain('aria-label="More actions"')
  })

  it('ActivityBarItem: pressed when active, badge text and the count in its name', () => {
    const out = html(React.createElement(ActivityBarItem, { icon: 'i', label: 'Agents', active: true, badge: 12 }))
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('aria-label="Agents (12)"')
    expect(out).toContain('>9+<')
    expect(out).toContain('is-active')
    const plain = html(React.createElement(ActivityBarItem, { icon: 'i', label: 'Plans', badge: 0 }))
    expect(plain).toContain('aria-label="Plans"')
    expect(plain).not.toContain('ui-activity__badge')
  })

  it('EditorTab: a tab with a named close button; dirty draws the dot; group focus picks the border', () => {
    const out = html(React.createElement(EditorTab, { label: 'Wall', description: 'T4', active: true, dirty: true, onClose: () => {}, closeLabel: 'Close' }))
    expect(out).toContain('role="tab"')
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('aria-label="Close"')
    expect(out).toContain('ui-etab__dot')
    expect(out).toContain('is-focused-group')
    expect(html(React.createElement(EditorTab, { label: 'x', active: true, groupFocused: false }))).toContain('is-blurred-group')
    expect(html(React.createElement(EditorTab, { label: 'x' }))).not.toContain('ui-etab__end')
  })

  it('StatusBarItem is a button with onClick, plain text without', () => {
    expect(html(React.createElement(StatusBarItem, { onClick: () => {}, children: 'Host ok' }))).toMatch(/^<button type="button" class="ui-status is-action"/)
    expect(html(React.createElement(StatusBarItem, { tone: 'danger', children: 'Host offline' }))).toMatch(/^<span class="ui-status ui-status--danger"/)
  })
})

describe('Modal role and description', () => {
  it('a plain Modal stays role="dialog" with no aria-describedby', () => {
    const out = html(React.createElement(Modal, { title: 'T', onClose: () => {}, children: 'body' }))
    expect(out).toMatch(/role="dialog"/)
    expect(out).not.toContain('role="alertdialog"')
    expect(out).not.toContain('aria-describedby')
  })

  it('the update gate is an alertdialog, labelled by its title and described by its body', () => {
    const out = html(React.createElement(UpdateGate, { update: { state: 'available', version: '2.0.0' } as never, onDownload: () => {}, onInstall: () => {}, onRetry: () => {} }))
    const dialog = out.match(/<div class="ui-modal [^"]*"[^>]*>/)?.[0] ?? ''
    expect(dialog).toContain('role="alertdialog"')
    expect(dialog).toContain('aria-modal="true"')
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1]
    const describedBy = /aria-describedby="([^"]+)"/.exec(dialog)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(out).toContain(`<h2 id="${labelledBy}"`)
    expect(out).toContain(`<p id="${describedBy}" class="update-gate-body">update.gate.body</p>`)
  })
})
