import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Input, Modal } from '../ui'
import { AccountSelect } from '../AccountSelect'
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
      <ProjectSettingsBody anchor={anchor} projectId={projectId} accounts={accounts} onLoaded={(p) => setName(p.name)} onRemoved={onClose} />
    </Modal>
  )
}

/** W7-B: every choice of one project. Each field saves on its own through `projects-set`; an empty number or choice
 *  clears it back to the default shown as the placeholder. */
export function ProjectSettingsBody({
  anchor,
  projectId,
  accounts,
  onLoaded,
  onRemoved
}: {
  anchor: string
  projectId: string
  accounts: Account[]
  onLoaded?: (project: Project) => void
  /** T6: the project was unregistered. */
  onRemoved?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  const [project, setProject] = useState<Project | null>(null)
  const [test, setTest] = useState('')
  const [concurrency, setConcurrency] = useState('')
  const [rounds, setRounds] = useState('')
  const [account, setAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  // T6: sub-project name being typed, the remove confirm, and the core's refusal shown inside that confirm
  const [subName, setSubName] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // W10-A: the prompts folder Run as written finds typed prompt names in
  const [prompts, setPrompts] = useState('')
  const [initial, setInitial] = useState({ test: '', concurrency: '', rounds: '', prompts: '' })

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
      setPrompts(p.promptsDir ?? '')
      const [runs, acc] = await Promise.all([window.api.run.list(p.path), window.api.projects.getDefaultAccount(p.path)])
      const cfg = runs.configs.find((c) => c.id === p.testConfigId)
      const command = cfg && 'command' in cfg && typeof cfg.command === 'string' ? cfg.command : ''
      setTest(command)
      setInitial({ test: command, concurrency: p.concurrency?.toString() ?? '', rounds: p.reviewRounds?.toString() ?? '', prompts: p.promptsDir ?? '' })
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
  // T6: a sub-project of this workspace (the same repository under its own name)
  const addSub = async (): Promise<void> => {
    const name = subName.trim()
    if (!name) return
    setError(null)
    const r = await window.api.orch.command(anchor, 'projects-add', { parent: projectId, name }).catch(() => null)
    if (r?.status === 200) setSubName('')
    else setError((r?.body as { error?: string } | null)?.error ?? 'Could not add the sub-project.')
  }
  const remove = async (): Promise<void> => {
    setRemoveError(null)
    const r = await window.api.orch.command(anchor, 'projects-remove', { id: projectId }).catch(() => null)
    if (r?.status === 200) {
      setConfirmRemove(false)
      setProject(null)
      onRemoved?.()
    } else setRemoveError((r?.body as { error?: string } | null)?.error ?? 'Could not remove the project.')
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
          {/* #117 */}
          <label className="check-small" title={t('project.handsOff.hint')}>
            <input type="checkbox" checked={project.handsOff ?? PROJECT_DEFAULTS.handsOff} onChange={(e) => void save({ handsOff: e.target.checked })} />
            {t('project.handsOff')}
          </label>
          {/* T6: only a workspace's root files plans under sub-projects, and a sub-project has no sub-projects (one level) */}
          {!project.parentId && (
            <>
              <label className="check-small" title={t('project.autoProjects.hint')}>
                <input type="checkbox" checked={project.autoProjects ?? true} onChange={(e) => void save({ autoProjects: e.target.checked })} />
                {t('project.autoProjects')}
              </label>
              <div className="field">
                <label>{t('project.sub.add')}</label>
                <div className="proj-sub-add">
                  <Input
                    value={subName}
                    placeholder={t('project.sub.name')}
                    aria-label={t('project.sub.name')}
                    onChange={(e) => setSubName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addSub()}
                  />
                  <Button disabled={subName.trim() === ''} onClick={() => void addSub()}>
                    {t('project.sub.submit')}
                  </Button>
                </div>
              </div>
            </>
          )}
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
            <label>Prompts folder (Run as written by name)</label>
            <input
              type="text"
              value={prompts}
              placeholder="found on the first Run as written"
              onChange={(e) => setPrompts(e.target.value)}
              onBlur={() => saveText('prompts', prompts, initial.prompts, { promptsDir: prompts.trim() })}
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
            <label htmlFor="project-origin-sync">{t('project.originSync')}</label>
            <select id="project-origin-sync" value={project.originSync ?? 'on'} onChange={(e) => void save({ originSync: e.target.value })}>
              <option value="on">{t('project.originSync.on')}</option>
              <option value="off">{t('project.originSync.off')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('account.select.projectDefault')}</label>
            <AccountSelect
              accounts={accounts}
              value={account}
              allLabel={t('account.select.none')}
              onChange={(id) => void save({ account: id })}
            />
          </div>
          <div className="field">
            <Button variant="danger" onClick={() => { setRemoveError(null); setConfirmRemove(true) }}>
              {t('project.remove')}
            </Button>
          </div>
        </>
      )}
      {confirmRemove && project && (
        <Modal
          title={t('project.remove.title', { name: project.name })}
          size="sm"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button onClick={() => setConfirmRemove(false)}>{t('project.remove.cancel')}</Button>
              <Button variant="danger" onClick={() => void remove()}>
                {t('project.remove.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('project.remove.body')}</p>
          {removeError && <p className="warn">{removeError}</p>}
        </Modal>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  )
}
