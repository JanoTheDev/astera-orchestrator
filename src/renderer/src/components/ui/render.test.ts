import { describe, it, expect } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Inbox } from 'lucide-react'
import { Badge, Button, Card, Chip, EmptyState, Field, Icon, Input, Kbd, kbdKeys, Menu, Meter, Nav, PageHeader, Section, Select, Tabs, Textarea } from './index'

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

  it('Nav marks the current page, Tabs the selected tab', () => {
    const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', count: 2 }]
    expect(html(React.createElement(Nav, { items, current: 'b', onSelect: () => {} }))).toMatch(/aria-current="page"[^>]*>B/)
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
    expect(html(React.createElement(Select, null, React.createElement('option', { value: 'a' }, 'A')))).toMatch(/^<select class="ui-select"><option/)
    expect(html(React.createElement(Textarea, { rows: 3 }))).toMatch(/^<textarea class="ui-textarea"/)
  })

  it('Field renders the house controls', () => {
    expect(html(React.createElement(Field, { label: 'N' }))).toContain('class="ui-input"')
    expect(html(React.createElement(Field, { label: 'N', kind: 'select', options: [{ value: 'a', label: 'A' }] }))).toContain('class="ui-select"')
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

describe('primitives.css', () => {
  it('uses tokens only: no colour literals', () => {
    const css = readFileSync(new URL('../../styles/primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })
})
