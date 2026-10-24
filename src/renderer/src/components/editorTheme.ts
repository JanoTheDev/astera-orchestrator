import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** The file editor's look: one fixed extension whose every colour is a CSS variable from styles/tokens.css.
 *  The app theme repaints the variables, so an open editor follows Night, Dusk and Day without its
 *  extensions being rebuilt — rebuilding them would drop the undo history (FileEditor's sharedBase).
 *
 *  `dark` is not set: CodeMirror's light/dark base themes are overridden here wherever they paint a colour. */
export const editorChrome = {
  '&': { color: 'var(--text)', backgroundColor: 'var(--editor-bg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: 'var(--fs-13)', lineHeight: 'var(--lh)' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--cm-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--wash)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--sp-2) 0 var(--sp-3)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-faint)', cursor: 'pointer' },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--text)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--wash-strong)',
    color: 'var(--text-dim)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '0 var(--sp-1)'
  },
  '.cm-searchMatch': { backgroundColor: 'var(--cm-match)', outline: '1px solid transparent' },
  // The match you are on must read as stronger than the rest; the ring carries most of it.
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--cm-match-current)',
    outline: '1px solid var(--cm-match-current-outline)'
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--wash-strong)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--wash-strong)', outline: '1px solid var(--line-strong)' },
  '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--elevated)',
    color: 'var(--text)',
    border: 'none',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-pop)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--list-active)', color: 'var(--text)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' }
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier, t.self], color: 'var(--syn-keyword)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--syn-comment)' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.escape, t.inserted], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.atom, t.null, t.constant(t.name), t.standard(t.name), t.unit], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.annotation], color: 'var(--syn-type)' },
  { tag: [t.variableName, t.deleted], color: 'var(--syn-variable)' },
  { tag: t.special(t.variableName), color: 'var(--syn-variable2)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: [t.operator, t.operatorKeyword, t.derefOperator], color: 'var(--syn-operator)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: t.attributeName, color: 'var(--syn-attr)' },
  { tag: t.heading, color: 'var(--syn-keyword)', fontWeight: 'var(--fw-semi)' },
  { tag: t.strong, fontWeight: 'var(--fw-semi)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--link)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--danger)' }
])

export const editorTheme: Extension = [EditorView.theme(editorChrome), syntaxHighlighting(highlight)]
/** The tag styles, for the test. */
export const editorHighlight = highlight
