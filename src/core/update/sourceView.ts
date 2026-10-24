// What the update UI says for an UpdateStatus (pure, node-free: the title bar, the settings card and the ready toast
// all read it). The releases channel keeps the wording it always had; the source channel (core/update/sourceUpdate.ts)
// adds "N new changes", the build step and a restart that needs no version number.
import type { Message, MessageKey } from '../i18n'
import type { UpdateStatus } from '../types'

/** Main stamps `sourceBuild` on every status of the source channel, so its presence is the channel test. */
export const isSourceStatus = (u: UpdateStatus | null): boolean => !!u?.sourceBuild

const changes = (u: UpdateStatus): number => u.source?.behind ?? 0

/** The title bar's notice: nothing, a plain label, an error label, the restart button, or the build button. */
export type TitlebarView =
  | { kind: 'none' }
  | { kind: 'text' | 'error' | 'button' | 'build'; message: Message }

export function titlebarView(u: UpdateStatus | null): TitlebarView {
  if (!u || u.state === 'init' || u.state === 'uptodate' || u.state === 'disabled') return { kind: 'none' }
  const version = u.version ?? ''
  const text = (key: MessageKey, params?: Message['params']): TitlebarView => ({ kind: 'text', message: { key, params } })
  switch (u.state) {
    case 'downloaded':
      return isSourceStatus(u)
        ? { kind: 'button', message: { key: 'update.tb.restartSource' } }
        : { kind: 'button', message: { key: 'update.tb.restartInstallVersion', params: { version } } }
    case 'manual':
      return { kind: 'button', message: { key: 'update.tb.manualInstallVersion', params: { version } } }
    case 'checking':
      return text('update.tb.checking')
    case 'available':
      if (!isSourceStatus(u) || !u.source) return text('update.tb.available', { version })
      // Only a build that can swap itself in has anything for the button to start.
      return u.sourceBuild?.selfInstall
        ? { kind: 'build', message: { key: 'update.tb.sourceUpdate', params: { count: changes(u) } } }
        : text('update.tb.sourceChanges', { count: changes(u) })
    case 'building':
      // Waiting for the heavy-job slot is not building yet, and says so in its own words.
      return u.step === 'waiting'
        ? text('update.tb.buildWaiting')
        : text('update.tb.building', { step: u.message ?? '' })
    case 'downloading':
      return text('update.tb.downloading', { percent: u.percent ?? 0 })
    default:
      return { kind: 'error', message: { key: 'update.tb.error' } }
  }
}

/** What the settings card shows about a source build: where it stands and which of the buttons apply. */
export interface SourceCard {
  /** Short sha of the running build. */
  commit: string
  phase: 'unknown' | 'checking' | 'upToDate' | 'changes' | 'building' | 'ready' | 'error'
  behind: number
  commits: { sha: string; subject: string }[]
  /** More commits than the 20 listed. */
  more: number
  buildStep?: UpdateStatus['step']
  showBuild: boolean
  showRestart: boolean
  /** Not Linux/AppImage: the channel can tell what is new but cannot build or swap itself in. */
  manualOnly: boolean
  error?: string
}

export function sourceCard(u: UpdateStatus): SourceCard {
  const sb = u.sourceBuild
  const commits = u.source?.commits ?? []
  const behind = changes(u)
  const manualOnly = !!sb && !sb.selfInstall
  const phase: SourceCard['phase'] =
    u.state === 'checking' ? 'checking'
    : u.state === 'uptodate' ? 'upToDate'
    : u.state === 'available' ? 'changes'
    : u.state === 'building' ? 'building'
    : u.state === 'downloaded' ? 'ready'
    : u.state === 'error' ? 'error'
    : 'unknown'
  return {
    commit: sb?.commit ?? '',
    phase,
    behind,
    commits,
    more: Math.max(0, behind - commits.length),
    buildStep: u.step,
    showBuild: phase === 'changes' && !manualOnly,
    showRestart: phase === 'ready' && !manualOnly,
    manualOnly,
    error: u.state === 'error' ? u.message : undefined
  }
}

/** The explanation line under the Automatic updates select. */
export const modeHintKey = (mode: string): MessageKey => `update.ui.mode.${mode}.hint` as MessageKey

/**
 * The toast for a source build that has just been built, once per target: `notified` is the target the last toast
 * was for. Null when there is nothing new to announce.
 */
export function sourceReadyToast(
  u: UpdateStatus,
  notified: string | null
): { target: string; message: Message; action: MessageKey } | null {
  if (!isSourceStatus(u) || u.state !== 'downloaded') return null
  const target = u.source?.target ?? u.version ?? ''
  if (!target || target === notified) return null
  const count = changes(u)
  return {
    target,
    message: count > 0 ? { key: 'update.ui.toastReady', params: { count } } : { key: 'update.toast.ready', params: { version: u.version ?? '' } },
    action: 'update.ui.restart'
  }
}
