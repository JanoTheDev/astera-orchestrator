// The window's title bar (W9-A moved it out of App.tsx). W9-B: it is the 44px top bar now (DESIGN-W11 §8): the 18px
// mark (the project switcher beside it carries the name that matters), then whatever App puts inside (TopBar), the update notice, and the window buttons.
import type { UpdateStatus } from '../../../../core/types'
import logoUrl from '../../assets/mark.svg'
import { confirmModalWithChoices } from '../../lib/confirm'
import { quitConfirmBody } from '../../lib/quitConfirm'
import { useI18n } from '../../i18n/I18nProvider'

function UpdateIndicator({
  update,
  onInstall
}: {
  update: UpdateStatus | null
  /** Installing quits the app, so this goes through App's installUpdate rather than calling
   *  window.api.update.install directly: that is where the person is told what quitting costs their
   *  running sessions, and every install path has to ask the same question. */
  onInstall: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  if (!update || update.state === 'init' || update.state === 'uptodate') return null
  if (update.state === 'downloaded')
    return (
      <button className="tb-update-btn" onClick={onInstall}>
        {t('update.tb.restartInstallVersion', { version: update.version ?? '' })}
      </button>
    )
  // The same build, and the same button, but restarting will not install it — so the titlebar must
  // not say it will. Without this branch 'manual' falls through to the error text below, which is
  // both wrong and unactionable.
  if (update.state === 'manual')
    return (
      <button className="tb-update-btn" onClick={onInstall}>
        {t('update.tb.manualInstallVersion', { version: update.version ?? '' })}
      </button>
    )
  const text =
    update.state === 'checking'
      ? t('update.tb.checking')
      : update.state === 'available'
        ? t('update.tb.available', { version: update.version ?? '' })
        : update.state === 'downloading'
          ? t('update.tb.downloading', { percent: update.percent ?? 0 })
          : t('update.tb.error')
  return (
    <span
      className={update.state === 'error' ? 'tb-update tb-update-err' : 'tb-update'}
      title={update.message}
    >
      {text}
    </span>
  )
}

export function Titlebar({
  isMax,
  update,
  runningCount,
  onInstall,
  children
}: {
  isMax: boolean
  update: UpdateStatus | null
  /** Only the close button reads it, and only on Linux — see closeWindow below */
  runningCount: number
  /** Passed straight through to UpdateIndicator's restart button — see the prop there. */
  onInstall: () => void
  /** What shares the bar — the TopBar. A slot, so the title bar does not know what it holds. */
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  // On macOS, window controls are handled by the OS traffic-light buttons. Drawing our own controls
  // too would put the same functionality at both ends of the window. .titlebar--mac reserves the
  // left-hand margin the traffic lights sit in.
  const isMac = window.api.platform === 'darwin'
  /** On Linux the X really quits the app (there is no tray to hide in — main/index.ts win.on('close')).
   *  What quitting costs is no longer one answer: with no Host, will-quit kills every running session,
   *  the same outcome the update install asks about; a session whose pty the Host owns keeps running
   *  instead, and the Host takes a moment to start, so at boot some of them are one and some the
   *  other. `quitConfirmBody` turns the two counts into the sentence that is true of both halves. The
   *  answer is read here rather than held in state because it changes during a run — the Host connects
   *  some milliseconds after launch. Nothing kept, on a failure, is the safe reading: it promises the
   *  person nothing comes back. On win32/macOS the window only hides, so nothing is asked. */
  const closeWindow = async (): Promise<void> => {
    if (window.api.platform === 'linux' && runningCount > 0) {
      const kept = await window.api.host.sessionsOutlivingApp().catch(() => 0)
      const body = quitConfirmBody(runningCount, kept)
      // When some sessions would be kept, the same dialog offers to end them too: the decision
      // belongs to the quit it rides on (host-replacement design §6). Taking it retires the Host
      // before quitting, which is the one path that reaches the ptys will-quit skips.
      const answer = await confirmModalWithChoices({
        title: t('common.quitConfirm.title'),
        body: t(body.key, body.params),
        confirmLabel: t('common.close'),
        choices:
          kept > 0
            ? [{ id: 'endKept', label: t('common.quitConfirm.endKept', { kept }), hint: t('common.quitConfirm.endKeptHint') }]
            : undefined
      })
      if (!answer.ok) return
      if (answer.checked.includes('endKept')) {
        window.api.app.quitEndingSessions()
        return
      }
    }
    window.api.win.close()
  }
  return (
    <div
      className={isMac ? 'titlebar titlebar--mac' : 'titlebar'}
      onDoubleClick={() => window.api.win.maximizeToggle()}
    >
      <div className="tb-brand" aria-hidden="true">
        <img className="tb-logo" src={logoUrl} alt="" />
      </div>
      {children ?? <span className="tb-spacer" />}
      <UpdateIndicator update={update} onInstall={onInstall} />
      {!isMac && (
        <div className="tb-controls" onDoubleClick={(e) => e.stopPropagation()}>
          <button
            className="tb-btn"
            aria-label={t('common.minimize')}
            title={t('common.minimize')}
            onClick={() => window.api.win.minimize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
          </button>
          <button
            className="tb-btn"
            aria-label={isMax ? t('common.restore') : t('common.maximize')}
            title={isMax ? t('common.restore') : t('common.maximize')}
            onClick={() => window.api.win.maximizeToggle()}
          >
            {isMax ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="1" y="2.5" width="6" height="6" />
                <rect x="2.5" y="1" width="6" height="6" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="1" y="1" width="8" height="8" />
              </svg>
            )}
          </button>
          <button
            className="tb-btn close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={() => void closeWindow()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
