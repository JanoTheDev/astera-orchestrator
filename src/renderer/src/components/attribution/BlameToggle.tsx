import { useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { blameLinesOf, type BlameLine } from './attribution'
import { blameExtension, setBlame } from './blameGutter'
import { BlameDetails } from './BlameDetails'
import './attribution.css'

/**
 * W8-B: the file viewer's blame toggle. On, it asks `attribution-blame` (W8-A) for the file and shows the gutter; off,
 * the gutter goes. It re-reads when the file or the editor's state changes (`epoch`, FileEditor's stateEpoch).
 * shortcut: the lines are the saved file's; unsaved edits above a line shift it until the next save re-reads.
 */
export function BlameToggle({
  view,
  file,
  projectPath,
  epoch
}: {
  view: EditorView | null
  file: string
  projectPath: string
  epoch: number
}): React.JSX.Element {
  const [on, setOn] = useState(false)
  const [picked, setPicked] = useState<BlameLine | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!view) return
    setPicked(null)
    if (!on) {
      setBlame(view, [])
      setNote(null)
      return
    }
    let live = true
    void window.api.orch
      .command(projectPath, 'attribution-blame', { file })
      .then((r) => {
        if (!live) return
        const lines = r.status === 200 ? blameLinesOf(r.body, file) : []
        setNote(r.status === 200 ? null : 'Attribution is not available for this file.')
        setBlame(view, blameExtension(lines, setPicked))
      })
      .catch(() => live && setNote('Attribution is not available for this file.'))
    return () => {
      live = false
    }
  }, [view, on, file, projectPath, epoch])
  return (
    <div className="attr-toggle-wrap">
      {picked && <BlameDetails line={picked} onClose={() => setPicked(null)} />}
      {note && on && (
        <span className="attr-note" role="status">
          {note}
        </span>
      )}
      <button type="button" className="attr-toggle" aria-pressed={on} onClick={() => setOn((v) => !v)}>
        Blame
      </button>
    </div>
  )
}
