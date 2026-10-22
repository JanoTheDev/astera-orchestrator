// T14: the New dialog's three cards open the right Start flow; the console is a quiet link.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

import { CHOICES, NewModal } from './NewModal'

/** Every element in the tree the dialog returns that has the prop, found without a DOM. */
function elementsWith(node: React.ReactNode, prop: string, out: React.ReactElement<Record<string, unknown>>[] = []): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(node)) return Array.isArray(node) ? (node.forEach((n) => elementsWith(n, prop, out)), out) : out
  const el = node as React.ReactElement<Record<string, unknown>>
  if (el.props[prop] !== undefined && typeof el.props[prop] === 'function') out.push(el)
  elementsWith(el.props.children as React.ReactNode, prop, out)
  return out
}

describe('New dialog', () => {
  const onStart = vi.fn()
  const onConsole = vi.fn()
  const tree = NewModal({ onClose: () => {}, onConsole, onStart })

  it('has the three ways to start as cards, in order, each with a sentence', () => {
    expect(CHOICES.map(([id]) => id)).toEqual(['chat', 'auto', 'prompts'])
    const html = renderToStaticMarkup(tree)
    for (const [, , label, hint] of CHOICES) {
      expect(html).toContain(label)
      expect(html).toContain(hint)
    }
    expect(html).toContain('new.consoleLink')
  })

  it('each card opens Start in its mode; the link opens a console', () => {
    const clickable = elementsWith(tree.props.children, 'onClick')
    expect(clickable).toHaveLength(4)
    clickable.slice(0, 3).forEach((c) => (c.props.onClick as () => void)())
    expect(onStart.mock.calls.map((c) => c[0])).toEqual(['chat', 'auto', 'prompts'])
    expect(onConsole).not.toHaveBeenCalled()
    ;(clickable[3].props.onClick as () => void)()
    expect(onConsole).toHaveBeenCalledOnce()
  })
})
