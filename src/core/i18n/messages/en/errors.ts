// English · errors area. Which files each area serves: ../README.md.
import type { errors as ko } from '../ko/errors'

export const errors: Record<keyof typeof ko, string> = {
  'app.renderError': 'Something went wrong while drawing this window.',
  'app.renderErrorReload': 'Reload',
}
