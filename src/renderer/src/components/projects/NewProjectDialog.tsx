import { useState } from 'react'
import { backdropProps } from '../../lib/backdrop'
import './projects.css'

interface Created {
  id: string
  path: string
  github?: { url?: string; error?: string }
}

/** W7-B: a new project folder (git init, first commit) with an optional GitHub repository. GitHub is outward-facing,
 *  so it is off until the owner ticks it. */
export function NewProjectDialog({
  anchor,
  onClose,
  onCreated,
  onStartPlan
}: {
  anchor: string
  onClose: () => void
  /** The project exists: the caller refreshes the switcher and opens it. */
  onCreated: (projectId: string) => void
  onStartPlan: (projectPath: string, objective: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [describe, setDescribe] = useState('')
  const [github, setGithub] = useState(false)
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<Created | null>(null)

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-create', {
        name: name.trim(),
        parent: parent.trim(),
        ...(describe.trim() ? { describe: describe.trim() } : {}),
        ...(github ? { github: visibility } : {})
      })
      if (r.status !== 200) {
        setError((r.body as { error?: string } | null)?.error ?? 'Could not create the project.')
        return
      }
      const p = r.body as Created
      setMade(p)
      onCreated(p.id)
    } catch {
      setError('Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" {...backdropProps(() => !busy && onClose())}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New project</h3>
        {made ? (
          <>
            <p className="proj-ok">Created {made.path}</p>
            {made.github?.url && <p>GitHub repository: {made.github.url}</p>}
            {made.github?.error && <p className="warn">The GitHub repository was not made: {made.github.error}</p>}
            <div className="row right">
              <button onClick={onClose}>Done</button>
              <button
                className="primary"
                onClick={() => {
                  onStartPlan(made.path, `Build the first version: ${describe.trim()}`)
                  onClose()
                }}
              >
                Start the first plan
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Parent folder</label>
              <div className="proj-row">
                <input type="text" value={parent} onChange={(e) => setParent(e.target.value)} />
                <button onClick={() => void window.api.system.pickFolder().then((p) => p && setParent(p))}>Browse</button>
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea rows={4} value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="What should it become?" />
            </div>
            <label className="check-small">
              <input type="checkbox" checked={github} onChange={(e) => setGithub(e.target.checked)} />
              Create a GitHub repository
            </label>
            {github && (
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            )}
            {error && <p className="warn">{error}</p>}
            <div className="row right">
              <button disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !name.trim() || !parent.trim()} onClick={() => void create()}>
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
