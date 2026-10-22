// Spanish · errors area. Which files each area serves: ../README.md.
import type { errors as ko } from '../ko/errors'

export const errors: Partial<Record<keyof typeof ko, string>> = {
  'app.renderError': 'Algo salió mal al dibujar esta ventana.',
  'app.renderErrorReload': 'Recargar',
}
