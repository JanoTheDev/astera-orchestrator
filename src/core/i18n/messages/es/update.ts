// Spanish · update area. Which files each area serves: ../README.md.
import type { update as ko } from '../ko/update'

export const update: Partial<Record<keyof typeof ko, string>> = {
  'update.manual.title': 'Instalar a mano',
  'update.manual.quit': 'Salir y moverla',
  // App.tsx — the toast for a downloaded new version, and the session-kill confirmation when installing now
  'update.toast.available': 'Ya está disponible la versión v{version}',
  'update.toast.download': 'Descargar',
  'update.confirm.title': 'Instalar y reiniciar ahora',
  'update.confirm.body': 'Se finalizarán {count} sesiones en curso. ¿Continuar?',
  // UpdateGate.tsx — the screen that covers the app when the version is below the minimum the release policy sets
  'update.gate.title': 'Hay que actualizar',
  'update.gate.body': 'Actualice a la versión {version}',
  'update.gate.bodyNoVersion': 'Actualice para continuar',
  'update.gate.preparing': 'Preparando la actualización…',
  'update.gate.ready': 'v{version} lista para instalar',
  'update.gate.failed':
    'No se pudo descargar la actualización. Compruebe la red y vuelva a intentarlo.',
  'update.gate.retry': 'Reintentar',
  'update.gate.quit': 'Salir de la aplicación',
}
