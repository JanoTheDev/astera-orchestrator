import { describe, it, expect } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Inbox } from 'lucide-react'
import { Button, Card, Chip, EmptyState, Field, Icon, Meter, Nav, Section, Tabs } from './index'

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

describe('primitives.css', () => {
  it('uses tokens only: no colour literals', () => {
    const css = readFileSync(new URL('../../styles/primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })
})
