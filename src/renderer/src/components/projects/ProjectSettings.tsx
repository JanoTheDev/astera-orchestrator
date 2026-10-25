import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type Project } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { Button, Chip, Field, Icon, Input, Modal, Select } from '../ui'
import { AccountSelect } from '../AccountSelect'
import { ProjectDelivery } from '../delivery/ProjectDelivery'
import { ProjectAttribution } from '../attribution/ProjectAttribution' // W8-B
import { PROJECT_CHIP, projectStateOf, type ProjectState } from './projectMenu'
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
  const { t } = useI18n()
  const [name, setName] = useState<string | null>(null)
  return (
    <Modal
      title={name === null ? t('project.settings.titleNoName') : t('project.settings.title', { name })}
      onClose={onClose}
      closeLabel={t('project.settings.close')}
      footer={<Button onClick={onClose}>{t('project.settings.close')}</Button>}
    >
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
  // the provider makes a new t each render: read through a ref so load keeps its identity
  const tRef = useRef(t)
  tRef.current = t
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
  // "Create GitHub repository": asked up front whether the folder has an origin (null until the answer comes back);
  // the 409 of projects-github-create still sets it when the answer was stale
  const [ghVisibility, setGhVisibility] = useState<'private' | 'public'>('private')
  const [ghBusy, setGhBusy] = useState(false)
  const [ghNote, setGhNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [hasOrigin, setHasOrigin] = useState<boolean | null>(null)
  const [state, setState] = useState<ProjectState>('ok')
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
      setError(tRef.current('project.error.read'))
    }
  }, [anchor, projectId])
  useEffect(() => {
    void load(true)
  }, [load])
  const projectPath = project?.path
  useEffect(() => {
    if (!projectPath) return
    let live = true
    setHasOrigin(null)
    void window.api.projects.hasOrigin(projectPath).then(
      (v) => live && setHasOrigin(v),
      () => live && setHasOrigin(false)
    )
    return () => {
      live = false
    }
  }, [projectPath])
  useEffect(() => {
    if (!projectPath) return
    let live = true
    void (async () => {
      const exists = await window.api.system.pathExists(projectPath).catch(() => undefined)
      const repo = exists === false ? undefined : (await window.api.worktrees.isGitRepo(projectPath).catch(() => undefined))?.kind
      if (live) setState(projectStateOf({ exists, repo }))
    })()
    return () => {
      live = false
    }
  }, [projectPath])
  useEffect(() => {
    void window.api.settings.getGithubDefaults().then((d) => setGhVisibility(d.visibility), () => {})
  }, [])
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
      if (r.status !== 200) setError((r.body as { error?: string } | null)?.error ?? t('project.error.save'))
    } catch {
      setError(t('project.error.save'))
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
    else setError((r?.body as { error?: string } | null)?.error ?? t('project.error.sub'))
  }
  const remove = async (): Promise<void> => {
    setRemoveError(null)
    const r = await window.api.orch.command(anchor, 'projects-remove', { id: projectId }).catch(() => null)
    if (r?.status === 200) {
      setConfirmRemove(false)
      setProject(null)
      onRemoved?.()
    } else setRemoveError((r?.body as { error?: string } | null)?.error ?? t('project.error.remove'))
  }
  const createGithub = async (path: string): Promise<void> => {
    setGhBusy(true)
    setGhNote(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-github-create', { project: path, [ghVisibility]: true })
      const body = r.body as { url?: string; error?: string } | null
      if (r.status === 200 && body?.url) {
        setHasOrigin(true)
        setGhNote({ ok: true, text: t('github.project.done', { url: body.url }) })
      } else if (r.status === 409 && body?.error?.includes('origin')) {
        setHasOrigin(true)
        setGhNote({ ok: true, text: t('github.project.hasOrigin') })
      } else setGhNote({ ok: false, text: body?.error ?? t('github.project.failed') })
    } catch {
      setGhNote({ ok: false, text: t('github.project.failed') })
    } finally {
      setGhBusy(false)
    }
  }
  // '' clears; a number outside the range is the backend's 400, shown as the error
  const num = (s: string): number | '' => (s.trim() === '' ? '' : Number(s))

  return (
    <div className="proj-settings">
      {project && (
        <>
          {state !== 'ok' && (
            <div className="ui-field">
              <Chip tone="warn">
                <Icon name={PROJECT_CHIP[state].icon} size={14} />
                {t(PROJECT_CHIP[state].key)}
              </Chip>
              {state === 'missing' && <span className="ui-field__hint">{t('project.state.missing.hint')}</span>}
            </div>
          )}
          <section className="proj-group" aria-labelledby={`proj-${projectId}-delivery`}>
            <h3 className="proj-group__title" id={`proj-${projectId}-delivery`}>{t('project.group.delivery')}</h3>
            <ProjectDelivery projectPath={project.path} />
            <ProjectAttribution anchor={anchor} projectId={projectId} />
            {!project.parentId && (hasOrigin === false || (hasOrigin && ghNote)) && (
              <div className="ui-field">
                <span className="ui-field__label">{t('github.project.create')}</span>
                {!hasOrigin && (
                  <div className="proj-sub-add">
                    <Select
                      ariaLabel={t('github.defaults.visibility')}
                      value={ghVisibility}
                      onChange={(v) => setGhVisibility(v as 'private' | 'public')}
                      items={[
                        { value: 'private', label: t('github.defaults.private') },
                        { value: 'public', label: t('github.defaults.public') }
                      ]}
                    />
                    <Button icon={<Icon name="branch" size={14} />} loading={ghBusy} onClick={() => void createGithub(project.path)}>
                      {t('github.project.create')}
                    </Button>
                  </div>
                )}
                {!hasOrigin && !ghNote && <span className="ui-field__hint">{t('github.project.hint')}</span>}
                {ghNote && <p className={ghNote.ok ? 'proj-ok' : 'warn'}>{ghNote.text}</p>}
              </div>
            )}
          </section>
          <section className="proj-group" aria-labelledby={`proj-${projectId}-plans`}>
            <h3 className="proj-group__title" id={`proj-${projectId}-plans`}>{t('project.group.plans')}</h3>
            <Field
              kind="toggle"
              label={t('project.autoApprove')}
              hint={t('project.autoApprove.hint')}
              checked={project.autoApprove ?? PROJECT_DEFAULTS.autoApprove}
              onChange={(on) => void save({ autoApprove: on })}
            />
            {/* #117 */}
            <Field
              kind="toggle"
              label={t('project.handsOff')}
              hint={t('project.handsOff.hint')}
              checked={project.handsOff ?? PROJECT_DEFAULTS.handsOff}
              onChange={(on) => void save({ handsOff: on })}
            />
            {/* T7: read on the workspace, whose plans share one file guard (schedule.ts serialFilesOf) */}
            {!project.parentId && (
              <Field
                kind="toggle"
                label={t('project.serialFiles')}
                hint={t('project.serialFiles.hint')}
                checked={project.serialFiles ?? PROJECT_DEFAULTS.serialFiles}
                onChange={(on) => void save({ serialFiles: on })}
              />
            )}
            <Field
              kind="select"
              label={t('project.replan')}
              hint={t('project.replan.hint')}
              value={project.replan ?? ''}
              onChange={(e) => void save({ replan: e.target.value })}
              options={[
                { value: '', label: t('project.replan.default', { value: t(`project.replan.${PROJECT_DEFAULTS.replan}`) }) },
                { value: 'waves', label: t('project.replan.waves') },
                { value: 'off', label: t('project.replan.off') }
              ]}
            />
            <Field
              kind="select"
              id="project-origin-sync"
              label={t('project.originSync')}
              value={project.originSync ?? 'on'}
              onChange={(e) => void save({ originSync: e.target.value })}
              options={[
                { value: 'on', label: t('project.originSync.on') },
                { value: 'off', label: t('project.originSync.off') }
              ]}
            />
            <Field
              label={t('project.prompts')}
              hint={t('project.prompts.hint')}
              value={prompts}
              placeholder={t('project.prompts.placeholder')}
              onChange={(e) => setPrompts(e.target.value)}
              onBlur={() => saveText('prompts', prompts, initial.prompts, { promptsDir: prompts.trim() })}
            />
          </section>
          <section className="proj-group" aria-labelledby={`proj-${projectId}-agents`}>
            <h3 className="proj-group__title" id={`proj-${projectId}-agents`}>{t('project.group.agents')}</h3>
            <Field
              kind="number"
              label={t('project.concurrency', { max: MAX_CONCURRENT_WORKERS })}
              hint={t('project.concurrency.hint')}
              min={1}
              max={MAX_CONCURRENT_WORKERS}
              value={concurrency}
              placeholder={String(PROJECT_DEFAULTS.concurrency)}
              onChange={(e) => setConcurrency(e.target.value)}
              onBlur={() => saveText('concurrency', concurrency, initial.concurrency, { concurrency: num(concurrency) })}
            />
            <Field
              kind="number"
              label={t('project.rounds')}
              hint={t('project.rounds.hint')}
              min={1}
              value={rounds}
              placeholder={String(PROJECT_DEFAULTS.reviewRounds)}
              onChange={(e) => setRounds(e.target.value)}
              onBlur={() => saveText('rounds', rounds, initial.rounds, { reviewRounds: num(rounds) })}
            />
            <Field
              label={t('project.test')}
              hint={t('project.test.hint')}
              value={test}
              placeholder={t('project.test.none')}
              onChange={(e) => setTest(e.target.value)}
              onBlur={() => saveText('test', test, initial.test, { testCommand: test.trim() })}
            />
            <div className="ui-field">
              <span className="ui-field__label">{t('account.select.projectDefault')}</span>
              <AccountSelect
                accounts={accounts}
                value={account}
                allLabel={t('account.select.none')}
                onChange={(id) => void save({ account: id })}
              />
            </div>
          </section>
          {/* T6: only a workspace's root files plans under sub-projects, and a sub-project has no sub-projects (one level) */}
          {!project.parentId && (
            <section className="proj-group" aria-labelledby={`proj-${projectId}-sub`}>
              <h3 className="proj-group__title" id={`proj-${projectId}-sub`}>{t('project.group.sub')}</h3>
              <Field
                kind="toggle"
                label={t('project.autoProjects')}
                hint={t('project.autoProjects.hint')}
                checked={project.autoProjects ?? true}
                onChange={(on) => void save({ autoProjects: on })}
              />
              <div className="ui-field">
                <span className="ui-field__label">{t('project.sub.add')}</span>
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
            </section>
          )}
          <div className="proj-remove">
            <Button
              icon={<Icon name="folder" size={14} />}
              disabled={state === 'missing'}
              onClick={() => void window.api.files.reveal(project.path).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
            >
              {t('project.reveal')}
            </Button>
            <Button variant="danger" icon={<Icon name="delete" size={14} />} onClick={() => { setRemoveError(null); setConfirmRemove(true) }}>
              {t('project.remove')}
            </Button>
          </div>
        </>
      )}
      {confirmRemove && project && (
        <Modal
          title={t('project.remove.title', { name: project.name })}
          size="sm"
          closeLabel={t('project.settings.close')}
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>{t('project.remove.cancel')}</Button>
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
