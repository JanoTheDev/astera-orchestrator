import { useId, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Field, Icon, Input, Modal } from '../ui'
import '../overlays.css'
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
  const { t } = useI18n()
  const pathId = useId()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsCommit, setNeedsCommit] = useState(false)
  const [needsGit, setNeedsGit] = useState(false)
  const [added, setAdded] = useState<{ id: string } | null>(null)
  const [test, setTest] = useState('')

  const add = async (initialCommit: boolean, initGit = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.orch.command(anchor, 'projects-add', {
        path: path.trim(),
        ...(initialCommit ? { initialCommit: true } : {}),
        ...(initGit ? { initGit: true } : {})
      })
      const body = r.body as {
        error?: string
        needsInitialCommit?: boolean
        needsGitInit?: boolean
        id?: string
        proposedTest?: string | null
      } | null
      setNeedsGit(false)
      if (r.status === 409 && body?.needsInitialCommit) {
        setNeedsCommit(true)
        setError(body.error ?? t('overlays.project.noCommit'))
      } else if (body?.needsGitInit) {
        setNeedsCommit(false)
        setNeedsGit(true)
        setError(null)
      } else if (r.status !== 200 || !body?.id) setError(body?.error ?? t('overlays.project.addFailed'))
      else {
        setNeedsCommit(false)
        setAdded({ id: body.id })
        setTest(body.proposedTest ?? '')
        onAdded(body.id)
      }
    } catch {
      setError(t('overlays.project.addFailed'))
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
        setError((r.body as { error?: string } | null)?.error ?? t('overlays.project.testSaveFailed'))
        return
      }
      onClose()
    } catch {
      setError(t('overlays.project.testSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const footer = added ? (
    <>
      <Button disabled={busy} onClick={onClose}>
        {t('overlays.project.skip')}
      </Button>
      <Button variant="primary" disabled={busy || !test.trim()} onClick={() => void saveTest()}>
        {t('overlays.project.useTest')}
      </Button>
    </>
  ) : (
    <>
      <Button disabled={busy} onClick={onClose}>
        {t('common.cancel')}
      </Button>
      {needsCommit && (
        <Button disabled={busy} onClick={() => void add(true)}>
          {t('overlays.project.initialCommit')}
        </Button>
      )}
      {needsGit && (
        <Button disabled={busy} onClick={() => void add(false, true)}>
          {t('onboarding.initGit.button')}
        </Button>
      )}
      <Button variant="primary" disabled={busy || !path.trim()} onClick={() => void add(false)}>
        {t('overlays.project.add')}
      </Button>
    </>
  )

  return (
    <Modal title={t('overlays.project.addTitle')} onClose={() => !busy && onClose()} closeLabel={t('common.close')} size="sm" footer={footer}>
      <div className="dlg">
        {added ? (
          <>
            <p className="proj-ok">{t('overlays.project.added')}</p>
            <Field
              label={t('overlays.project.testCommand')}
              hint={t('overlays.project.testHint')}
              value={test}
              onChange={(e) => setTest(e.target.value)}
              placeholder={t('overlays.project.testNone')}
            />
            {error && <p className="warn">{error}</p>}
          </>
        ) : (
          <>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={pathId}>
                {t('overlays.project.folder')}
              </label>
              <div className="ov-proj-row">
                <Input id={pathId} value={path} onChange={(e) => { setPath(e.target.value); setNeedsGit(false) }} autoFocus />
                <Button icon={<Icon name="folder" />} onClick={() => void window.api.system.pickFolder().then((p) => p && setPath(p))}>
                  {t('overlays.project.browse')}
                </Button>
              </div>
            </div>
            {needsGit && <p className="warn">{t('onboarding.initGit.hint')}</p>}
            {error && <p className="warn">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
