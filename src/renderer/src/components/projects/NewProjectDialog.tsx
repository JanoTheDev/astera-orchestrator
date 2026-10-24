import { useEffect, useId, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Field, Icon, Input, Modal } from '../ui'
import '../overlays.css'
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
  const { t } = useI18n()
  const parentId = useId()
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [describe, setDescribe] = useState('')
  const [github, setGithub] = useState(false)
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  // pre-filled from Settings > GitHub; the owner can still change both here
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    void window.api.settings.getGithubDefaults().then((d) => {
      if (touched) return
      setGithub(d.createGithubRepo)
      setVisibility(d.visibility)
    }, () => undefined)
    // read once on open: a later edit of the toggles must not be overwritten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
        setError((r.body as { error?: string } | null)?.error ?? t('overlays.project.createFailed'))
        return
      }
      const p = r.body as Created
      setMade(p)
      onCreated(p.id)
    } catch {
      setError(t('overlays.project.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  const footer = made ? (
    <>
      <Button onClick={onClose}>{t('overlays.project.done')}</Button>
      <Button
        variant="primary"
        onClick={() => {
          onStartPlan(made.path, t('overlays.project.firstPlanObjective', { description: describe.trim() }))
          onClose()
        }}
      >
        {t('overlays.project.startPlan')}
      </Button>
    </>
  ) : (
    <>
      <Button disabled={busy} onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button variant="primary" disabled={busy || !name.trim() || !parent.trim()} onClick={() => void create()}>
        {t('overlays.project.create')}
      </Button>
    </>
  )

  return (
    <Modal title={t('overlays.project.newTitle')} onClose={() => !busy && onClose()} closeLabel={t('common.close')} size="sm" footer={footer}>
      <div className="dlg">
        {made ? (
          <>
            <p className="proj-ok">{t('overlays.project.created', { path: made.path })}</p>
            {made.github?.url && <p>{t('overlays.project.githubUrl', { url: made.github.url })}</p>}
            {made.github?.error && <p className="warn">{t('overlays.project.githubError', { error: made.github.error })}</p>}
          </>
        ) : (
          <>
            <Field label={t('overlays.project.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={parentId}>
                {t('overlays.project.parentFolder')}
              </label>
              <div className="ov-proj-row">
                <Input id={parentId} value={parent} onChange={(e) => setParent(e.target.value)} />
                <Button icon={<Icon name="folder" />} onClick={() => void window.api.system.pickFolder().then((p) => p && setParent(p))}>
                  {t('overlays.project.browse')}
                </Button>
              </div>
            </div>
            <Field
              kind="textarea"
              label={t('overlays.project.description')}
              rows={4}
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              placeholder={t('overlays.project.descriptionPlaceholder')}
            />
            <Field kind="toggle" label={t('overlays.project.github')} checked={github} onChange={(on) => { setTouched(true); setGithub(on) }} />
            {github && (
              <Field
                kind="select"
                label={t('overlays.project.visibility')}
                value={visibility}
                onChange={(e) => { setTouched(true); setVisibility(e.target.value as 'private' | 'public') }}
                options={[
                  { value: 'private', label: t('overlays.project.private') },
                  { value: 'public', label: t('overlays.project.public') }
                ]}
              />
            )}
            {error && <p className="warn">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
