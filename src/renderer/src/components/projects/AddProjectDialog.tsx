import { useState } from 'react'
import { backdropProps } from '../../lib/backdrop'
import './projects.css'

/** W7-B: an existing git folder becomes a project. A repository with no commit is only committed after the owner
 *  clicks "Make the initial commit". */
export function AddProjectDialog({
  anchor,
  onClose,
  onAdded
}: {
  anchor: string
  onClose: () => void
  onAdded: (projectId: string) => void
}): React.JSX.Element {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsCommit, setNeedsCommit] = useState(false)
  const [added, setAdded] = useState<{ id: string } | null>(null)
  const [test, setTest] = useState('')

  const add = async (initialCommit: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-add', {
        path: path.trim(),
        ...(initialCommit ? { initialCommit: true } : {})
      })
      const body = r.body as {
        error?: string
        needsInitialCommit?: boolean
        id?: string
        proposedTest?: string | null
      } | null
      if (r.status === 409 && body?.needsInitialCommit) {
        setNeedsCommit(true)
        setError(body.error ?? 'This repository has no commit yet.')
      } else if (r.status !== 200 || !body?.id) setError(body?.error ?? 'Could not add the project.')
      else {
        setNeedsCommit(false)
        setAdded({ id: body.id })
        setTest(body.proposedTest ?? '')
        onAdded(body.id)
      }
    } catch {
      setError('Could not add the project.')
    } finally {
      setBusy(false)
    }
  }

  const saveTest = async (): Promise<void> => {
    if (!added) return
    setBusy(true)
    try {
      const r = await window.api.orch.command(anchor, 'projects-set', {
        id: added.id,
        testCommand: test.trim()
      })
      if (r.status !== 200) {
        setError((r.body as { error?: string } | null)?.error ?? 'Could not save the test command.')
        return
      }
      onClose()
    } catch {
      setError('Could not save the test command.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" {...backdropProps(() => !busy && onClose())}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add project</h3>
        {added ? (
          <>
            <p className="proj-ok">Project added.</p>
            <div className="field">
              <label>Test command</label>
              <input type="text" value={test} onChange={(e) => setTest(e.target.value)} placeholder="none" />
              <p className="modal-hint">New tasks are checked with this. Leave it empty to skip.</p>
            </div>
            {error && <p className="warn">{error}</p>}
            <div className="row right">
              <button disabled={busy} onClick={onClose}>
                Skip
              </button>
              <button className="primary" disabled={busy || !test.trim()} onClick={() => void saveTest()}>
                Use this test command
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Project folder</label>
              <div className="proj-row">
                <input type="text" value={path} onChange={(e) => setPath(e.target.value)} autoFocus />
                <button onClick={() => void window.api.system.pickFolder().then((p) => p && setPath(p))}>Browse</button>
              </div>
            </div>
            {error && <p className="warn">{error}</p>}
            <div className="row right">
              <button disabled={busy} onClick={onClose}>
                Cancel
              </button>
              {needsCommit && (
                <button disabled={busy} onClick={() => void add(true)}>
                  Make the initial commit
                </button>
              )}
              <button className="primary" disabled={busy || !path.trim()} onClick={() => void add(false)}>
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
