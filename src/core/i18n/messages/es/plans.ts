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
  'pages.plans.wave': 'Paso {at} de {of}',
  'pages.plans.coordinator': 'Agentes líder · planes en curso',
  'pages.plans.workers': '{n} agentes trabajando',
  'pages.plans.lease': 'archivos en uso por {plan}',
  'pages.plans.restartLead': "Reiniciar el agente líder",
  'pages.plans.restartLeadHint': "Ningún agente líder gestiona este plan. Haz clic para iniciar uno de nuevo",
  'pages.plans.holdNew': "Dejar de lanzar agentes nuevos (los que ya trabajan siguen)",
  'pages.plans.releaseNew': "Volver a lanzar agentes nuevos",
  'pages.plans.approveHint': "Aprobar este plan e iniciar sus agentes",
  'pages.plans.sharedFolderHint': "Se ejecuta en la misma carpeta que un agente de otro plan. Sus ediciones pueden mezclarse y la app ni lo impide ni lo detecta",
  'pages.plans.host.waiting': "Conectando con el servicio en segundo plano",
  'pages.plans.host.unreachable': "No se puede contactar con el servicio en segundo plano",
  'pages.plans.host.features': "Los planes, el seguimiento de tareas, el navegador del agente y Smart Resume esperan a esta conexión",
  'pages.plans.stall.unresponsive': "El servicio en segundo plano no responde, así que los planes no avanzan. Puedes reiniciarlo en Ajustes, Info",
  'pages.plans.stall.reading': "El servicio en segundo plano aún lee sus ajustes, así que los planes todavía no avanzan",
  'pages.plans.stall.parked': "El servicio en segundo plano ha pausado los planes: {reason}",
  'pages.plans.roundNumber': "ronda n.º {n}",
  'pages.plans.roundsSoFar': "{count} rondas hasta ahora",
}
