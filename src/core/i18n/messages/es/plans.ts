// Spanish · plans area. Which files each area serves: ../README.md.
import type { plans as ko } from '../ko/plans'

export const plans: Partial<Record<keyof typeof ko, string>> = {
  'pages.plans.status.deliveryDismissed': 'Descartada',
  'jobs.convergence.chip.repairing': 'Corrección {repairs}/{max}',
  'jobs.convergence.chip.reviewing': 'Revisión {round}/{max}',
  'jobs.convergence.chip.exhausted': 'Agotado',
  'jobs.convergence.chip.stopped': 'auto-reparación detenida',
  'jobs.source.chipOpen': 'Abrir {label} en el navegador',
  // JobsView.tsx — después del provider en una fila en ejecución. Si está esperando, esto
  // reemplaza el tiempo transcurrido, y el historial de reanudaciones se añade después
  // ({left}/{n} es la sustitución {name} de core/i18n/index.ts).
  'jobs.task.waitingReset': 'Esperando el reinicio · {left}',
  'jobs.task.waitingNoTime': 'Esperando el reinicio',
  'jobs.task.resumedCount': 'reanudada {n}×',
}
