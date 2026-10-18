import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type Project } from '../../../../core/orchestration/types'
import { Button, Modal } from '../ui'
import { ProjectDelivery } from '../delivery/ProjectDelivery'
import { ProjectAttribution } from '../attribution/ProjectAttribution' // W8-B
import './projects.css'

/** W7-B: one project's settings as a dialog (the project switcher's gear). The body is the Settings page's Projects
 *  group too (W9-E). */
export function ProjectSettings({
  anchor,
  projectId,
  accounts,
  onClose
}: {
  anchor: string
  projectId: string
  accounts: Account[]
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState<string | null>(null)
  return (
    <Modal title={`${name ?? 'Project'} settings`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <ProjectSettingsBody anchor={anchor} projectId={projectId} accounts={accounts} onLoaded={(p) => setName(p.name)} />
    </Modal>
  )
}

/** W7-B: every choice of one project. Each field saves on its own through `projects-set`; an empty number or choice
 *  clears it back to the default shown as the placeholder. */
export function ProjectSettingsBody({
  anchor,
  projectId,
  accounts,
  onLoaded
}: {
  anchor: string
  projectId: string
  accounts: Account[]
  onLoaded?: (project: Project) => void
}): React.JSX.Element {
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  const [project, setProject] = useState<Project | null>(null)
  const [test, setTest] = useState('')
  const [concurrency, setConcurrency] = useState('')
  const [rounds, setRounds] = useState('')
  const [account, setAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [initial, setInitial] = useState({ test: '', concurrency: '', rounds: '' })

  // `fields`: also fill the inputs. Only the first read does: a re-read after a save must not overwrite a field the
  // person is typing in meanwhile.
  const load = useCallback(async (fields: boolean): Promise<void> => {
    try {
      const list = await window.api.orch.command(anchor, 'projects-list', {})
      const p = list.status === 200 ? (list.body as Project[]).find((x) => x.id === projectId) : undefined
      if (!p) return
      setProject(p)
      loaded.current?.(p)
      if (!fields) return
      setConcurrency(p.concurrency?.toString() ?? '')
      setRounds(p.reviewRounds?.toString() ?? '')
      const [runs, acc] = await Promise.all([window.api.run.list(p.path), window.api.projects.getDefaultAccount(p.path)])
      const cfg = runs.configs.find((c) => c.id === p.testConfigId)
      const command = cfg && 'command' in cfg && typeof cfg.command === 'string' ? cfg.command : ''
      setTest(command)
      setInitial({ test: command, concurrency: p.concurrency?.toString() ?? '', rounds: p.reviewRounds?.toString() ?? '' })
      setAccount(acc ?? '')
    } catch {
      setError('Could not read the project.')
    }
  }, [anchor, projectId])
  useEffect(() => {
    void load(true)
  }, [load])
  const [saved, setSaved] = useState<Record<string, string>>({})
  // Saves a text field on blur, only when it differs from what was last read or saved
  const saveText = (key: string, value: string, initial: string, args: Record<string, unknown>): void => {
    if ((saved[key] ?? initial) === value.trim()) return
    setSaved((m) => ({ ...m, [key]: value.trim() }))
    void save(args)
  }

  const save = async (args: Record<string, unknown>): Promise<void> => {
    setError(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-set', {
        id: projectId,
        ...args
      })
      if (r.status !== 200) setError((r.body as { error?: string } | null)?.error ?? 'Could not save.')
    } catch {
      setError('Could not save.')
    }
    await load(false)
  }
  // '' clears; a number outside the range is the backend's 400, shown as the error
  const num = (s: string): number | '' => (s.trim() === '' ? '' : Number(s))

  return (
    <div className="proj-settings">
      {project && (
        <>
          <ProjectDelivery projectPath={project.path} />
          <ProjectAttribution anchor={anchor} projectId={projectId} />
          <label className="check-small">
            <input
              type="checkbox"
              checked={project.autoApprove ?? PROJECT_DEFAULTS.autoApprove}
              onChange={(e) => void save({ autoApprove: e.target.checked })}
            />
            Approve plans automatically
          </label>
          <div className="field">
            <label>Test command</label>
            <input
              type="text"
              value={test}
              placeholder="none"
              onChange={(e) => setTest(e.target.value)}
              onBlur={() => saveText('test', test, initial.test, { testCommand: test.trim() })}
            />
          </div>
          <div className="field">
            <label>Workers at once (1-{MAX_CONCURRENT_WORKERS})</label>
            <input
              type="number"
              min={1}
              max={MAX_CONCURRENT_WORKERS}
              value={concurrency}
              placeholder={String(PROJECT_DEFAULTS.concurrency)}
              onChange={(e) => setConcurrency(e.target.value)}
              onBlur={() => saveText('concurrency', concurrency, initial.concurrency, { concurrency: num(concurrency) })}
            />
          </div>
          <div className="field">
            <label>Review rounds</label>
            <input
              type="number"
              min={1}
              value={rounds}
              placeholder={String(PROJECT_DEFAULTS.reviewRounds)}
              onChange={(e) => setRounds(e.target.value)}
              onBlur={() => saveText('rounds', rounds, initial.rounds, { reviewRounds: num(rounds) })}
            />
          </div>
          <div className="field">
            <label>Replan between waves</label>
            <select value={project.replan ?? ''} onChange={(e) => void save({ replan: e.target.value })}>
              <option value="">Default ({PROJECT_DEFAULTS.replan})</option>
              <option value="waves">Waves</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div className="field">
            <label>Default account</label>
            <select value={account} onChange={(e) => void save({ account: e.target.value })}>
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  )
}
