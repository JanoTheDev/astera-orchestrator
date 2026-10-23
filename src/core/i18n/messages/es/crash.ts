// Spanish · crash area. Which files each area serves: ../README.md.
import type { crash as ko } from '../ko/crash'

export const crash: Partial<Record<keyof typeof ko, string>> = {
  'crash.prompt.title': '¿Enviar un informe de error?',
  'crash.prompt.intro':
    'Astera tuvo un error. Abajo está el informe tal como se enviaría. Enviar abre en tu navegador una nueva incidencia de GitHub con este texto, donde aún puedes editarla o cancelarla. Si no, nada sale de este equipo.',
  'crash.prompt.kept': 'Los informes se quedan solo en este equipo, 30 días como máximo.',
  'crash.prompt.send': 'Enviar',
  'crash.prompt.dontSend': 'No enviar',
  'crash.prompt.never': 'No volver a preguntar',
  'crash.prompt.reportLabel': 'El informe que se enviaría'
}
