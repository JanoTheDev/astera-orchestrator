import type { Message, MessageKey } from '../i18n'
import type { InstallOutcome, UpdateStatus } from '../types'

/**
 * What to tell the person once the install button has done its work.
 *
 * Null on the automatic path is not an omission: the app quits within the same tick, so anything
 * put on screen there would flash and vanish. The other two branches are the whole reason this
 * function exists — before them, a macOS install that Squirrel had already refused produced no
 * quit, no message and no way to tell the difference from a dead button.
 */
export function installOutcomeNotice(outcome: InstallOutcome): Message | null {
  switch (outcome.mode) {
    case 'auto':
      return null
    case 'manual':
      return { key: 'update.manual.done', params: { path: outcome.appPath } }
    case 'failed':
      return { key: 'update.manual.failed', params: { message: outcome.message } }
  }
}

/**
 * The toast that offers to install a build that has arrived, or null when there is nothing to offer.
 *
 * 'manual' gets its own wording for the same reason the title bar and the Info row do: it follows
 * 'downloaded' by about a second on an ad-hoc-signed macOS release, and a toast still saying
 * "ready, install now" is offering a restart that cannot install anything.
 */
export function readyToast(update: UpdateStatus): { message: Message; action: MessageKey } | null {
  const params = { version: update.version ?? '' }
  switch (update.state) {
    case 'downloaded':
      return { message: { key: 'update.toast.ready', params }, action: 'update.toast.installNow' }
    case 'manual':
      return { message: { key: 'update.toast.manual', params }, action: 'update.toast.manualInstall' }
    default:
      return null
  }
}
