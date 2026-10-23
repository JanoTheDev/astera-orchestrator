// Spanish · misc area. Which files each area serves: ../README.md.
import type { misc as ko } from '../ko/misc'

export const misc: Partial<Record<keyof typeof ko, string>> = {
  'session.usage.fiveHourLabel': 'Uso de 5 h',
  // W2-A planner stage
  'jobs.new.planner': 'Planificar primero con el planificador',
  'jobs.new.schedule': 'Ejecución programada',
  'remote.sessions.signedOut': 'Sin sesión',
  'new.console': 'Consola',
  'new.plan': 'Planéalo por mí',
  'new.prompts': 'Ejecutar tal cual',
  'start.title': '¿Qué construimos en {project}?',
  // T2 Start: Audit mode, sticky hands-off, More options
  // T4 Start opens the planner chat
}
