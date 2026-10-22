// Spanish · about area. Which files each area serves: ../README.md.
import type { about as ko } from '../ko/about'

export const about: Partial<Record<keyof typeof ko, string>> = {
  'settings.group.about': 'Acerca de',
  'about.buildVersion': 'Versión de compilación',
  'about.copy': 'Copiar',
  'about.copied': 'Copiado',
  'about.copyVersion': 'Copiar versión de compilación',
  'about.updateChannel': 'Canal de actualizaciones',
  'about.channel.stable': 'Estable',
  'about.channel.beta': 'Beta',
  'about.channel.hint': 'Estable recibe solo versiones terminadas. Beta recibe también versiones de prueba antes de que lleguen a todos.',
  'about.channel.saveFailed': 'No se pudo guardar el canal de actualizaciones: {detail}',
  'about.crashReports': 'Informes de errores',
  'about.crash.ask': 'Preguntar',
  'about.crash.never': 'Nunca',
  'about.crash.hint': 'Cuando Astera tiene un error, pregunta si enviar un informe. Lo lees antes de que salga a ningún sitio. Nunca deja de preguntar.',
  'about.crash.saveFailed': 'No se pudo guardar el ajuste de informes de errores: {detail}',
  'about.license': 'Licencia',
  'about.license.personal': 'Compilación personal',
  'about.licenses.title': 'Licencias de código abierto',
  'about.licenses.hint': 'El software con el que está hecho Astera y los términos que lo acompañan.',
  'about.licenses.open': 'Ver',
  'about.licenses.search': 'Buscar licencias',
  'about.licenses.count': '{count} elementos',
  'about.licenses.empty': 'Ninguna licencia coincide con "{query}".',
  'about.licenses.loading': 'Cargando…',
  'about.licenses.missingTitle': 'La lista de licencias aún no se ha generado',
  'about.licenses.missing': 'Ejecuta node scripts/gen-licenses.mjs en la carpeta de Astera y vuelve a abrir esta ventana. Las apps instaladas ya la incluyen.',
  'about.licenses.noText': 'Este paquete no incluye archivo de licencia. Su campo de licencia dice {license}.',
  'about.licenses.pick': 'Elige un elemento a la izquierda para leer su texto completo.'
}
