import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorChrome, editorHighlight, editorTheme } from './editorTheme'

/** Every value that paints a colour: the theme must read tokens, never carry a literal of its own. */
const COLOUR_KEYS = /color|background|border|outline|shadow/i
const LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i

const chromeColours = Object.entries(editorChrome).flatMap(([selector, rules]) =>
  Object.entries(rules as Record<string, string>)
    .filter(([key]) => COLOUR_KEYS.test(key))
    .map(([key, value]) => [selector, key, value] as const)
)

describe('editorTheme', () => {
  it('is an extension an EditorState accepts', () => {
    const state = EditorState.create({ doc: 'const a = 1', extensions: [editorTheme] })
    expect(state.doc.toString()).toBe('const a = 1')
  })

  it('paints the editor on the workbench editor surface in the code face', () => {
    expect(editorChrome['&'].backgroundColor).toBe('var(--editor-bg)')
    expect(editorChrome['.cm-gutters'].backgroundColor).toBe('var(--editor-bg)')
    expect(editorChrome['.cm-scroller'].fontFamily).toBe('var(--mono)')
  })

  it('finds the chrome colours — an empty list would pass on nothing', () => {
    expect(chromeColours.length).toBeGreaterThan(15)
  })

  it.each(chromeColours)('%s %s reads a token', (_selector, _key, value) => {
    expect(value).not.toMatch(LITERAL)
    if (value !== 'none' && value !== 'transparent' && !/^1px solid transparent$/.test(value)) expect(value).toMatch(/var\(--/)
  })

  it('colours every highlight tag from a token', () => {
    const colours = editorHighlight.specs.map((s) => s.color).filter((c): c is string => typeof c === 'string')
    expect(colours.length).toBeGreaterThan(10)
    for (const c of colours) expect(c).toMatch(/^var\(--[\w-]+\)$/)
  })
})
