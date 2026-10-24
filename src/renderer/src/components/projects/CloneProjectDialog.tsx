import { useEffect, useId, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Field, Icon, Input, Modal } from '../ui'
import { canClone, cloneProblem, defaultClonePath } from './cloneModel'
import '../overlays.css'
import './projects.css'

/** Clone a repository into a new project (`projects-add --clone`): the Host clones with this machine's git
 *  credentials into the chosen folder, or ~/astera-projects/<name>, then registers it. */
export function CloneProjectDialog({
  anchor,
  onClose,
  onAdded
}: {
  anchor: string
  onClose: () => void
  onAdded: (projectId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const destId = useId()
  const [url, setUrl] = useState('')
  const [dest, setDest] = useState('')
  const [home, setHome] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.api.system.homeDir().then(setHome, () => undefined)
  }, [])
  const problem = cloneProblem(url, dest)

  const clone = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-add', { clone: url.trim(), ...(dest.trim() ? { path: dest.trim() } : {}) })
      const body = r.body as { error?: string; id?: string } | null
      if (r.status !== 200 || !body?.id) setError(body?.error ?? t('onboarding.clone.failed'))
      else {
        onAdded(body.id)
        onClose()
      }
    } catch {
      setError(t('onboarding.clone.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('onboarding.clone.title')}
      onClose={() => !busy && onClose()}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!canClone(url, dest, busy)} onClick={() => void clone()}>
            {t('onboarding.clone.submit')}
          </Button>
        </>
      }
    >
      <div className="dlg">
        <Field label={t('onboarding.clone.url')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" autoFocus disabled={busy} />
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={destId}>
            {t('onboarding.clone.dest')}
          </label>
          <div className="ov-proj-row">
            <Input id={destId} value={dest} onChange={(e) => setDest(e.target.value)} placeholder={home ? defaultClonePath(url, home) : ''} disabled={busy} />
            <Button disabled={busy} icon={<Icon name="folder" />} onClick={() => void window.api.system.pickFolder().then((p) => p && setDest(p))}>
              {t('overlays.project.browse')}
            </Button>
          </div>
          {home && <span className="ui-field__hint">{t('onboarding.clone.destHint', { path: defaultClonePath(url, home) })}</span>}
        </div>
        {busy && <p role="status" className="proj-ok">{t('onboarding.clone.cloning')}</p>}
        {(problem || error) && <p className="warn">{problem ? t(problem) : error}</p>}
      </div>
    </Modal>
  )
}
