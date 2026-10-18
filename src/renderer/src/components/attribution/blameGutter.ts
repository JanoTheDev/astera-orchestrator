// W8-B: the blame gutter in the file viewer (FileEditor.tsx). One chip per line, a real <button>, so Tab reaches it
// and Enter or Space opens it, and its aria-label says what the short text abbreviates (markerOf).
//
// The gutter lives in a compartment of its own, added to a view the first time blame is shown and emptied when it is
// hidden, so FileEditor's base extensions (built once, cached per file) stay untouched.
import { Compartment, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import { markerOf, type BlameLine } from './attribution'

export const blameCompartment = new Compartment()

export class ChipMarker extends GutterMarker {
  constructor(
    readonly l: BlameLine,
    readonly pick: (l: BlameLine) => void
  ) {
    super()
  }
  eq(other: ChipMarker): boolean {
    return other.l === this.l
  }
  toDOM(): Node {
    const m = markerOf(this.l)
    const b = document.createElement('button')
    b.type = 'button'
    b.className = m.className
    b.textContent = m.text
    b.title = m.label
    b.setAttribute('aria-label', m.label)
    b.addEventListener('click', () => this.pick(this.l))
    return b
  }
}

/** The gutter for these lines; `pick` runs when a chip is activated. */
export function blameExtension(lines: readonly BlameLine[], pick: (l: BlameLine) => void): Extension {
  const byLine = new Map(lines.map((l) => [l.line, l]))
  return gutter({
    class: 'attr-gutter',
    lineMarker(view, block) {
      const l = byLine.get(view.state.doc.lineAt(block.from).number)
      return l ? new ChipMarker(l, pick) : null
    },
    lineMarkerChange: () => false,
    initialSpacer: () => new ChipMarker({ line: 0, kind: 'unknown' }, () => {})
  })
}

/** Puts `ext` in the view's blame compartment ([] hides it), adding the compartment on first use. */
export function setBlame(view: EditorView, ext: Extension): void {
  if (blameCompartment.get(view.state) === undefined) view.dispatch({ effects: StateEffect.appendConfig.of(blameCompartment.of(ext)) })
  else view.dispatch({ effects: blameCompartment.reconfigure(ext) })
}
