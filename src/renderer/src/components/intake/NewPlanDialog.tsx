import { useEffect, useState } from 'react'
import type { Account } from '../../../../core/types'
import type { Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { formFailure, type OrchDoor } from '../../lib/orchDoor'
import { AccountSelect } from '../AccountSelect'
import { backdropProps } from '../../lib/backdrop'
import { intakeRequest, type IntakeTab } from './intakeRequest'

/** A GitHub issue as `sources-items` answers it. */
interface IssueRow {
  id: string
  title: string
  selectable?: boolean
  reason?: string
}

const TABS: IntakeTab[] = ['describe', 'files', 'audit', 'github']

/** W6-A "New plan": a Job from a description, files, an audit or GitHub issues, with the owner's extra instructions.
 *  It makes the Job (`jobs-create` / `jobs-create-from-issue`, intakeRequest.ts) and starts its planner (`jobs-plan`);
 *  the Host checks and copies everything. This computer's projects only: attached paths are this computer's. */
export function NewPlanDialog({
  door,
  cwd,
  accounts,
  onClose,
  onCreated
}: {
  door: OrchDoor
  /** The open project's folder: picked first. */
  cwd: string
  accounts: Account[] | null
  onClose: () => void
  onCreated: (jobId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [tab, setTab] = useState<IntakeTab>('describe')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [text, setText] = useState('')
  const [fixlist, setFixlist] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [scope, setScope] = useState('')
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(false)
  const [issues, setIssues] = useState<IssueRow[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [assignMe, setAssignMe] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void door.command('projects-list', {}).then((r) => {
      if (r.status !== 200 || !Array.isArray(r.body)) return
      const list = r.body as Project[]
      setProjects(list)
      setProjectId((cur) => cur || (list.find((p) => p.path === cwd) ?? list[0])?.id || '')
    })
  }, [door, cwd])
  const project = projects.find((p) => p.id === projectId) ?? null

  // The GitHub search, a moment after the last key: GitHub's search is rate limited.
  useEffect(() => {
    if (tab !== 'github' || project === null) return
    const timer = setTimeout(() => {
      void door
        .command('sources-items', { source: 'github', project: project.id, ...(query.trim() ? { query: query.trim() } : {}), ...(mine ? { assignedToMe: true } : {}) })
        .then((r) => {
          const body = r.body as { items?: IssueRow[]; error?: string } | null
          if (r.status === 200 && Array.isArray(body?.items)) {
            setIssues(body.items)
            setError(null)
          } else setError(typeof body?.error === 'string' ? body.error : t('jobs.new.failed'))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [tab, project, query, mine, door, t])

  const request = intakeRequest({
    tab,
    text,
    fixlist,
    files,
    scope,
    issues: picked,
    assignMe,
    instructions,
    project: project && { id: project.id, path: project.path },
    coordinatorAccount: account
  })

  const addFiles = (list: FileList | null): void => {
    if (!list) return
    const paths = Array.from(list, (f) => window.api.files.pathForFile(f)).filter((p) => p !== '')
    setFiles((cur) => [...cur, ...paths.filter((p) => !cur.includes(p))])
  }

  const create = async (): Promise<void> => {
    if (request === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command(request.cmd, request.args)
      if (reply.status >= 400) {
        setError(formFailure(reply, t as never, 'jobs.new.failed').message)
        return
      }
      const id = (reply.body as { id: string }).id
      // Every intake ends with its planner started; a planner that does not start leaves the Job as a draft.
      const planned = await door.command('jobs-plan', { id })
      if (planned.status >= 400) {
        const why = (planned.body as { error?: unknown } | null)?.error
        setError(`${t('jobs.new.plannerFailed')}${typeof why === 'string' ? `: ${why}` : ''}`)
        return
      }
      onCreated(id)
    } catch {
      setError(t('jobs.new.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" {...backdropProps(() => !busy && onClose())}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('intake.title')}</h2>
        <div className="field">
          <label>{t('intake.project')}</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" role="tablist">
          {TABS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)}>
              {t(`intake.tab.${k}` as const)}
            </button>
          ))}
        </div>
        {tab === 'describe' && (
          <div className="field">
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('intake.describe')} autoFocus />
            <label className="check-small">
              <input type="checkbox" checked={fixlist} onChange={(e) => setFixlist(e.target.checked)} />
              {t('intake.fixlist')}
            </label>
          </div>
        )}
        {tab === 'files' && (
          <div className="field">
            <div
              className="intake-drop"
              style={{ border: '1px dashed currentColor', padding: 16, textAlign: 'center' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                addFiles(e.dataTransfer.files)
              }}
            >
              {t('intake.drop')}
              <input type="file" multiple aria-label={t('intake.drop')} onChange={(e) => addFiles(e.target.files)} />
            </div>
            {files.map((f) => (
              <div key={f} className="row">
                <span>{f}</span>
                <button aria-label={t('common.cancel')} onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}>
                  ×
                </button>
              </div>
            ))}
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('intake.note')} />
          </div>
        )}
        {tab === 'audit' && (
          <div className="field">
            <label>{t('intake.scope')}</label>
            <input type="text" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="all" />
            <p className="modal-hint">{t('intake.auditHint')}</p>
          </div>
        )}
        {tab === 'github' && (
          <div className="field">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('intake.search')} />
            <label className="check-small">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              {t('intake.mine')}
            </label>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {issues.map((i) => (
                <label key={i.id} className="check-small" title={i.reason}>
                  <input
                    type="checkbox"
                    disabled={i.selectable === false}
                    checked={picked.includes(i.id)}
                    onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                  />
                  #{i.id} {i.title}
                </label>
              ))}
            </div>
            <label className="check-small">
              <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} />
              {t('intake.assignMe')}
            </label>
          </div>
        )}
        <div className="field">
          <label>{t('intake.instructions')}</label>
          <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        {accounts !== null && (
          <div className="field">
            <label>{t('jobs.new.coordinator')}</label>
            <AccountSelect accounts={accounts} value={account} onChange={setAccount} allLabel={t('jobs.new.coordinatorPick')} />
          </div>
        )}
        {error && <p className="warn">{error}</p>}
        <div className="row right">
          <button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy || request === null} onClick={() => void create()}>
            {t('intake.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
