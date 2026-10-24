// English · update area. Which files each area serves: ../README.md.
import type { update as ko } from '../ko/update'

export const update: Record<keyof typeof ko, string> = {
  'update.manual.title': 'Install by hand',
  'update.manual.quit': 'Quit and move it',
  'update.toast.available': 'Version v{version} is available',
  'update.toast.updatedTo': 'Updated to {sha}',
  'update.toast.updatedMore': 'and {count} more',
  'update.toast.download': 'Download',
  'update.confirm.title': 'Install and restart now',
  'update.confirm.body': '{count} running session(s) will be terminated. Continue?',
  'update.confirm.bodyKept':
    '{count} running session(s) keep running while Astera restarts. Whether the new version takes them back depends on the update, so they may not come back. Continue?',
  'update.confirm.bodyMixed':
    '{ended} running session(s) will be terminated. The other {kept} keep running while Astera restarts, and whether the new version takes them back depends on the update. Continue?',
  'update.gate.title': 'Update required',
  'update.gate.body': 'Please update to version {version}',
  'update.gate.bodyNoVersion': 'Please update to continue',
  'update.gate.preparing': 'Preparing the update…',
  'update.gate.ready': 'v{version} is ready to install',
  'update.gate.failed': 'Could not download the update. Check your network and try again.',
  'update.gate.retry': 'Try again',
  'update.gate.quit': 'Quit app',
}
