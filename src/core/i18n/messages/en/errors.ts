// English · errors area. Which files each area serves: ../README.md.
import type { errors as ko } from '../ko/errors'

export const errors: Record<keyof typeof ko, string> = {
  'app.renderError': 'Something went wrong while drawing this window.',
  'app.renderErrorReload': 'Reload',
  'app.renderErrorWhat': 'This page stopped working. Reloading usually fixes it, and your work is saved.',
  'app.renderErrorDetails': 'Error details',
  'app.renderErrorCopy': 'Copy details',
  'app.renderErrorCopied': 'Copied',
  'app.renderErrorReport': 'Report',
}
