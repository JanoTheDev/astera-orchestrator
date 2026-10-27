// Spanish · prs area. Which files each area serves: ../README.md.
import type { prs as ko } from '../ko/prs'

export const prs: Record<keyof typeof ko, string> = {
  'prs.refresh': 'Actualizar',
  'prs.filter': 'Filtrar por título, autor o rama',
  'prs.noProject': 'Elige un proyecto para ver sus pull requests.',
  'prs.loading': 'Cargando pull requests…',
  'prs.empty': 'No hay pull requests abiertos.',
  'prs.noMatch': 'Ningún pull request coincide con el filtro.',
  'prs.notInstalled': 'La CLI de GitHub (gh) no está instalada. Instálala y reinicia la app.',
  'prs.notAuthenticated': 'No has iniciado sesión en GitHub.',
  'prs.openSettings': 'Abrir ajustes de GitHub',
  'prs.noRemote': 'Este proyecto no tiene remoto de GitHub.',
  'prs.error': 'No se pudieron cargar los pull requests: {detail}',
  'prs.draft': 'Borrador',
  'prs.review': 'Revisar con IA',
  'prs.github': 'Abrir en GitHub',
  'prs.merge': 'Fusionar',
  'prs.notMergeable': 'Aún no se puede fusionar. Revisa conflictos, comprobaciones requeridas y revisiones.',
  'prs.alreadyMerged': 'Ya está fusionado o cerrado.',
  'prs.updated': 'hace {age}',
  'prs.menu': 'Acciones del pull request',
  'prs.list': 'Lista de pull requests'
}
