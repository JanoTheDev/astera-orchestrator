import { useId } from 'react'
import { Button, Modal } from './ui'
import './overlays.css'
import './sessionDialog.css'
import { useI18n } from '../i18n/I18nProvider'
import type { UpdateStatus } from '../../../core/types'

/**
 * Blocking-mode campaign screen (later switched over to being campaign-based). It only appears when the
 * policy has put this app in scope with `mode: "block"`, and there is no way out other than updating —
 * download, install, retry and quit are all there is.
 *
 * The titlebar is not covered (overlays.css pulls the Modal's backdrop below it), so moving and minimizing the window still work (it has to be possible to
 * get the window out of the way while waiting for the download).
 * autoDownload normally starts the download by itself; the button here covers the case where it has
 * not started yet or has failed.
 */
export function UpdateGate({
  update,
  onDownload,
  onInstall,
  onRetry
}: {
  update: UpdateStatus | null
  onDownload: () => void
  onInstall: () => void
  onRetry: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const bodyId = useId()
  // 'manual' counts as ready here. It means the build is on disk and installable — just by hand
  // rather than by restarting, which is what onInstall works out for itself. Leaving it out would
  // strand a person the campaign has already blocked on "preparing…" with no button that does
  // anything, which is the one screen in the app with no way around it.
  const ready = update?.state === 'downloaded' || update?.state === 'manual'
  const downloading = update?.state === 'downloading'
  const available = update?.state === 'available'
  const version = update?.version

  const primary = ready ? (
    <Button variant="primary" autoFocus onClick={onInstall}>
      {t('update.toast.installNow')}
    </Button>
  ) : available ? (
    <Button variant="primary" autoFocus onClick={onDownload}>
      {t('update.toast.download')}
    </Button>
  ) : (
    <Button variant="primary" loading={downloading} onClick={onRetry}>
      {t('update.gate.retry')}
    </Button>
  )

  // No onClose: the gate has no way out but updating, so the Modal draws no Close button and Esc does nothing.
  return (
    <div className="update-gate">
      <Modal
        size="sm"
        title={t('update.gate.title')}
        role="alertdialog"
        describedBy={bodyId}
        footer={
          <>
            <Button variant="ghost" onClick={() => window.api.app.quit()}>
              {t('update.gate.quit')}
            </Button>
            {primary}
          </>
        }
      >
        <div className="sd-body" role="status">
          <p id={bodyId} className="update-gate-body">
            {version ? t('update.gate.body', { version }) : t('update.gate.bodyNoVersion')}
          </p>
          <p className="sd-hint">
            {downloading
              ? t('update.info.downloading', { percent: update?.percent ?? 0 })
              : ready
                ? t('update.gate.ready', { version: version ?? '' })
                : update?.state === 'error'
                  ? t('update.gate.failed')
                  : t('update.gate.preparing')}
          </p>
        </div>
      </Modal>
    </div>
  )
}
