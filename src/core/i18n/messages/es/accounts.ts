// Spanish · accounts area. Which files each area serves: ../README.md.
import type { accounts as ko } from '../ko/accounts'

export const accounts: Partial<Record<keyof typeof ko, string>> = {
  'settings.accounts.hint':
    "«Importar configuración» copia la configuración de la cuenta predeterminada del mismo CLI. La predeterminada es la primera cuenta registrada con la sesión iniciada, una por CLI.",
  // AccountPanel.tsx — account register, import, detect, logout, settings sync
  'account.field.kind': 'Tipo',
  'account.field.label': 'Etiqueta',
  'account.panel.title': 'Cuentas',
  'account.panel.empty': 'Agregue una cuenta',
  'account.add.title': 'Agregar cuenta',
  'account.add.button': 'Agregar',
  'account.add.adding': 'Agregando…',
  'account.add.labelPlaceholder': 'Ej.: Cuenta del trabajo',
  'account.add.copySettingsLabel': 'Importar la configuración de la cuenta predeterminada',
  'account.add.syncFailed': 'La cuenta se agregó, pero falló la importación de la configuración: {detail}',
  'account.import.title': 'Importar cuenta',
  'account.import.button': 'Importar',
  'account.import.someFailed': 'No se pudieron registrar {count} cuentas.',
  'account.detect.title': 'Cuentas detectadas',
  'account.detect.empty': 'No se detectaron cuentas',
  'account.detect.importSelected': 'Registrar selección',
  'account.detect.failed': 'Falló la detección automática: {detail}',
  // AccountPanel.tsx — unregister. When logout comes with it, it says the credentials are removed (destructive).
  'account.remove.title': 'Anular el registro de la cuenta',
  'account.remove.button': 'Anular registro',
  'account.remove.confirm': '¿Anular el registro de la cuenta «{label}»?',
  'account.remove.logoutToo': 'Cerrar sesión también (elimina la autenticación)',
  'account.remove.logoutWarning':
    'Al cerrar sesión se elimina la autenticación de esta cuenta y tendrá que volver a iniciar sesión. Si la cuenta usa un directorio de inicio (~/.claude, ~/.codex), también se cerrará la sesión que utilizaba fuera de esta aplicación.',
  'account.remove.processing': 'Procesando…',
  'account.remove.confirmWithLogout': 'Anular y cerrar sesión',
  'account.logout.failed': 'La cuenta se eliminó, pero no se pudo cerrar sesión: {detail}',
  'account.remove.inUse': 'Una sesión en curso está usando esta cuenta, así que no se puede anular su registro: {titles}\n\nCierra la sesión o quita la cuenta de su orden de rotación.',
  'account.remove.willClose': 'Se cerrarán {count} sesión(es) de worker terminada(s): {titles}',
  'account.remove.releaseFailed': 'No se pudo cerrar una sesión de worker terminada, así que la cuenta no se dio de baja: {detail}',
  // Merging two accounts of one login (Settings › Accounts)
  'account.merge.sameLogin': 'Mismo inicio de sesión que {label}',
  'account.merge.button': 'Fusionar',
  'account.merge.title': 'Fusionar cuentas',
  'account.merge.confirm': '¿Fusionar «{drop}» en «{keep}»? La cuenta «{keep}» se queda.',
  'account.merge.note': 'Las tareas, los planes y las cuentas predeterminadas de proyecto que usan «{drop}» pasan a «{keep}», y después se anula el registro de «{drop}». Es el mismo inicio de sesión, así que no se elimina ninguna autenticación.',
  'account.merge.confirmButton': 'Fusionar en {keep}',
  'account.merge.processing': 'Fusionando…',
  'account.merge.done': 'Fusionada en {keep}.',
  'account.merge.inUse': 'Una sesión en curso está usando «{drop}», así que no se puede fusionar: {titles}\n\nCierra la sesión primero o quita la cuenta de su orden de rotación.',
  'account.merge.failed': 'No se pudieron fusionar las cuentas. Puede que ya no sean el mismo inicio de sesión o que la orquestación aún no esté lista.',
  // AccountPanel.tsx — default-account settings sync. A destructive action that overwrites the target account's settings.
  'account.sync.title': 'Importar la configuración de la cuenta predeterminada',
  'account.sync.confirmBody':
    'Se importará la configuración de la cuenta «{source}» a la cuenta «{label}».',
  'account.sync.mergeNote':
    'Los plugins, MCP y las habilidades, comandos y agentes personales se combinan elemento por elemento. Los elementos coincidentes toman el valor del origen y los que solo tiene esta cuenta se conservan.',
  'account.sync.replaceNote':
    'El archivo config.toml se reemplaza por completo con el del origen. La configuración exclusiva de esta cuenta se pierde; el archivo existente se respalda como .bak.',
  'account.sync.appliesNextSession':
    'No se aplica a las sesiones en ejecución: surte efecto a partir de la siguiente sesión.',
  'account.sync.confirm': 'Importar',
  'account.sync.confirming': 'Importando…',
  'account.sync.done': 'Se importó la configuración.',
  'account.sync.failed': 'Error al importar: {detail}',
  // Usage run-out estimate: when the account runs out at the current pace, before its reset
  'account.usage.runOut': 'A este ritmo (~{rate}%/h) se agota en {duration}, antes del reinicio',
  'account.usage.lasts': 'A este ritmo (~{rate}%/h) dura hasta el reinicio',
  // Account picker: the signed-out label, the usage figures and the project default row
  'account.select.signedOut': 'sin sesión',
  'account.select.usage': '5 h {session}% · semana {weekly}%',
  // Switch a running tab account: the menu action, its confirmation and its failure messages
  'account.switch.action': 'Usar en esta pestaña',
  'account.switch.title': 'Mover la pestaña abierta a {label}; la conversación continúa allí',
  'account.switch.done': 'Esta pestaña ahora usa {label}',
  'account.switch.failed': 'No se pudo cambiar de cuenta: {detail}',
  'account.switch.busy': 'Esta pestaña ya está cambiando de cuenta; inténtalo de nuevo en un momento',
  'account.switch.noTab': 'Abre una pestaña de sesión para moverla a otra cuenta',
  'account.switch.otherProvider': 'Solo las cuentas de {provider} pueden tomar esta pestaña',
  // W3 redesign: rename button, near-limit cue, plain import button, empty states
  'account.rename.button': "Renombrar",
  'account.menu.label': "Acciones de {label}",
  'account.usage.nearLimit': "Cerca del límite",
  'account.sync.button': "Importar configuración",
  'account.empty.body': "Las cuentas permiten a Astera ejecutar agentes con su suscripción de Claude o Codex. Agregue una para empezar.",
  'account.empty.bodySettings': "Agregue una desde el menú de cuentas de la barra superior.",
  'account.signInAgain.button': 'Volver a iniciar sesión',
  'account.signOut.button': 'Cerrar sesión',
  'account.signOut.title': 'Cerrar sesión de {label}',
  'account.signOut.confirm': '¿Cerrar sesión de {label}? La cuenta seguirá en la lista y podrá volver a iniciar sesión.',
  'account.signOut.done': 'Se cerró la sesión de {label}.',
  'account.signOut.failed': 'No se pudo cerrar la sesión: {detail}',
  'account.signOut.processing': 'Cerrando sesión…',
  'account.status.paused': 'En pausa',
  'account.signIn.retry': 'Reintentar',
  // T2: plan display names
  'account.plan.free': 'Gratis',
  'account.plan.pro': 'Pro',
  'account.plan.max': 'Max',
  'account.plan.team': 'Team',
  'account.plan.enterprise': 'Enterprise',
  'account.plan.ultra': 'Ultra',
  'account.plan.unknown': 'Desconocido',
}
