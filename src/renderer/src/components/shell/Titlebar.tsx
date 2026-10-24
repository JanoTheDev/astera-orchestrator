// The window's title bar (W9-A moved it out of App.tsx). DESIGN-W13 §8: 35px, the 18px mark, the command center in the
// middle (whatever App puts inside), the update notice, and the window buttons.
import type { UpdateStatus } from '../../../../core/types'
import logoUrl from '../../assets/mark.svg'
import { confirmModalWithChoices } from '../../lib/confirm'
import { quitConfirmBody } from '../../lib/quitConfirm'
import { useI18n } from '../../i18n/I18nProvider'
import { titlebarView } from '../../../../core/update/sourceView'
import { Button, Icon, IconButton, Kbd } from '../ui'
import { formatChord } from '../../../../core/keys/binding'
import { requestBox } from '../command/boxStore'
import { ProjectSwitcher } from './ProjectSwitcher'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

function UpdateIndicator({
  update,
  onInstall,
  onBuild
}: {
  update: UpdateStatus | null
  /** Installing quits the app, so this goes through App's installUpdate rather than calling
   *  window.api.update.install directly: that is where the person is told what quitting costs their
   *  running sessions, and every install path has to ask the same question. */
  onInstall: () => void
  /** Starts the source build for new commits; the restart that follows still goes through onInstall. */
  onBuild: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const view = titlebarView(update)
  if (view.kind === 'none') return null
  const text = t(view.message.key, view.message.params)
  if (view.kind === 'button' || view.kind === 'build')
    return (
      <Button variant="secondary" size="sm" className="tb-update-install" icon={<Icon name="refresh" size={14} />} onClick={view.kind === 'build' ? onBuild : onInstall}>
        {text}
      </Button>
    )
  return (
    <span className={view.kind === 'error' ? 'tb-update tb-update-err' : 'tb-update'} title={update?.message}>
      {text}
    </span>
  )
}

export function Titlebar({
  isMax,
  update,
  runningCount,
  onInstall,
  onBuild,
  children
}: {
  isMax: boolean
  update: UpdateStatus | null
  /** Only the close button reads it, and only on Linux — see closeWindow below */
  runningCount: number
  /** Passed straight through to UpdateIndicator's restart button — see the prop there. */
  onInstall: () => void
  /** Passed straight through to UpdateIndicator's build button. */
  onBuild: () => void
  /** What shares the bar. A slot, so the title bar does not know what it holds. */
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
      <UpdateIndicator update={update} onInstall={onInstall} onBuild={onBuild} />
      {!isMac && (
        <div className="tb-controls" onDoubleClick={(e) => e.stopPropagation()}>
          {/* square, flush with the window edge like the OS's own chrome (shell.css .tb-win) */}
          <IconButton className="tb-win" icon={<Icon name="remove" />} label={t('common.minimize')} onClick={() => window.api.win.minimize()} />
          <IconButton
            className="tb-win"
            icon={<Icon name={isMax ? 'copy' : 'stop'} />}
            label={isMax ? t('common.restore') : t('common.maximize')}
            onClick={() => window.api.win.maximizeToggle()}
          />
          <IconButton className="tb-win close" icon={<Icon name="close" />} label={t('common.close')} onClick={() => void closeWindow()} />
        </div>
      )}
    </div>
  )
}

export type CommandCenterProps = Pick<
  AppState,
  | 'bindingsRef' | 'openWorkspaceProject' | 'projectAnchor' | 'sessions' | 'setProjectDialog' | 'setCommandOpen' | 't'
  | 'workspaceIds' | 'workspaceProjectId' | 'workspaceTree'
> &
  Pick<ShellState, 'attention'>

/** DESIGN-W13 §8: the title bar's middle, one field: the project part (its dot and name open the switcher), then
 *  "Search or run a command" and its chord, which opens the command box. The bar around it still drags the window. */
export function CommandCenter(p: CommandCenterProps): React.JSX.Element {
  const { t } = p
  const chord = p.bindingsRef.current['palette.open']?.[0]
  return (
    <>
      <span className="tb-spacer" />
      <div className="wb-cc" onDoubleClick={(e) => e.stopPropagation()}>
        <ProjectSwitcher
          tree={p.workspaceTree}
          byWorkspace={p.workspaceIds}
          sessions={p.sessions}
          attention={p.attention}
          selectedId={p.workspaceProjectId}
          onSelect={p.openWorkspaceProject}
          onNew={() => p.setProjectDialog('new')}
          onAdd={() => p.setProjectDialog('add')}
          onSettings={(id) => p.setProjectDialog({ settings: id })}
          onOpenWindow={(id) => window.api.win.openNew(id)} // W9-K
          toolsDisabledReason={p.projectAnchor ? undefined : t('settings.projects.noAnchor')}
          t={t}
        />
        <Button variant="ghost" size="sm" className="wb-cc__search" icon={<Icon name="search" size={14} />} title={chord ? `${t('shell.commandCenter')} (${formatChord(chord)})` : undefined} onClick={() => {
            requestBox('>')
            p.setCommandOpen(true)
          }}>
          <span className="wb-cc__hint">{t('shell.commandCenter')}</span>
          {chord && <Kbd>{formatChord(chord)}</Kbd>}
        </Button>
      </div>
      <span className="tb-spacer" />
    </>
  )
}
