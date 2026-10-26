// Spanish · agents area. Which files each area serves: ../README.md.
import type { agents as ko } from '../ko/agents'

export const agents: Partial<Record<keyof typeof ko, string>> = {
  'session.placeholder.start': '+ Empiece con una sesión nueva',
  // App.tsx — run console resizer, start failure
  'run.resizeConsole': 'Ajustar el tamaño de la consola',
  // WorkbenchTabs.tsx — the dirty marker on a file tab
  'explorer.tab.unsaved': 'Sin guardar',
  // WorkbenchTabs.tsx
  'session.tab.rollTooltip': 'Rotación: {chain}',
  // ConversationPane.tsx — exited banner (session-failure-visibility design D2/F2). Este catálogo
  // parcial aún no tiene el resto de las claves conversation.* (se sustituyen por en/ko); estas tres
  // se añaden antes que las demás.
  'conversation.indexingFiles': 'Indexando archivos…',
  'conversation.filesUnavailable': 'La lista de archivos no está disponible para esta carpeta.',
  'conversation.exited.detail': 'Detalles',
  'conversation.exited.restart': 'Reiniciar',
  // Los cinco puntos de la confirmación de design §4 F5. Una excepción a S1 (una o dos líneas) — la
  // persona está tomando una decisión que nadie más puede tomar, y quitar los hechos dejaría solo un botón.
  'conversation.exited.bypassConfirm.title': '¿Omitir la configuración de toolchain de esta carpeta y reintentar?',
  'conversation.exited.bypassConfirm.whatBlockedLabel': 'Qué lo bloqueó',
  'conversation.exited.bypassConfirm.whatBlocked':
    'No fue la CLI. El gestor de versiones de herramientas por delante en el PATH (Volta) se negó a ejecutarse. Necesita leer el package.json de esta carpeta para elegir una versión, y no pudo',
  // fix round 1 / Important 4: usada cuando solo coincidió la señal más débil (VOLTA_HOME). Que
  // Volta esté instalado en esta máquina es un hecho; que haya bloqueado *esta* CLI no lo es — Volta
  // puede estar gestionando Node mientras esta CLI es una instalación aparte que bloqueó un antivirus.
  'conversation.exited.bypassConfirm.whatBlockedSoft':
    'No necesariamente la CLI misma. Un gestor de versiones de herramientas (Volta) instalado en esta máquina podría ser la causa. Si esta CLI es una de las que gestiona, Volta por delante en el PATH pudo haberse negado a ejecutarse al intentar leer el package.json de esta carpeta para elegir una versión',
  'conversation.exited.bypassConfirm.ifSkippedLabel': 'Si lo omites',
  'conversation.exited.bypassConfirm.ifSkipped': 'Se omite la resolución de versión y se ejecuta la CLI que quede por defecto en el PATH. La sesión se inicia.',
  'conversation.exited.bypassConfirm.givesUpLabel': 'Qué se pierde',
  'conversation.exited.bypassConfirm.givesUp':
    'La versión de la herramienta fijada para este proyecto. No solo esta sesión: todos los comandos que ejecute (el propio npm test, npm run build, node … del agente) se ejecutarán con la versión por defecto, no con la fijada. El mismo comando puede dar un resultado distinto al de tu terminal. Lo mismo vale para la sesión que tome el relevo si un límite de uso cambia de cuenta.',
  'conversation.exited.bypassConfirm.properFixLabel': 'La solución real',
  'conversation.exited.bypassConfirm.properFix': 'Si arreglas el package.json, este cuadro no volverá a aparecer.',
  'conversation.exited.bypassConfirm.confirm': 'Omitir y reintentar',
  'conversation.exited.bypassConfirm.failed': 'No se pudo reintentar',
  // fix round 1 (Critical 2): la marca duradera — a diferencia de `notice`, nunca se borra y se
  // muestra siempre como su propia línea mientras esta sesión (y luego su historial) esté abierta.
  'conversation.bypassed.badge': 'Esta sesión se inició omitiendo la versión de toolchain fijada para este proyecto',
  // TerminalView.tsx — the rolling banner and the loading/exit overlays
  'session.terminal.rollSwitching': 'Continuando con «{label}»…',
  'session.terminal.trustAccepting': 'Aceptando automáticamente la confianza de la carpeta…',
  // {time} here is fmtDateTime (M/D HH:MM), not fmtTime — no preposition can precede it
  'session.terminal.weeklyLimitWaiting': 'Límite semanal agotado — reanudación: {time}',
  'session.terminal.limitWaiting': 'Límite alcanzado — se reanudará a las {time}',
  'session.terminal.loadingContent': 'Cargando el contenido…',
  'session.terminal.sizedRemote': 'Se muestra con el tamaño de ventana del equipo remoto. Escribe aquí para usar el tamaño de esta ventana.',
  'session.terminal.restart': 'Reiniciar',
  'session.terminal.schedNextRun': ' · próxima ejecución {time}',
  'session.terminal.schedDisable': 'Desactivar',
  'run.panel.empty': 'Aún no se ha ejecutado nada. Pulsa Ejecutar en la barra de herramientas para iniciar una configuración.',
  'run.panel.stopping': 'Deteniendo…',
  'run.panel.close': 'Cerrar ejecución',
  'run.panel.openPreview': 'Abrir {url} en una vista previa',
  'conversation.sentFile.open': 'Abrir {name}',
  // ---- preview ----
  'preview.tab.untitled': 'Vista previa',
  'preview.agent.tab': 'agente',
  'preview.agent.running': 'El agente está manejando esta página',
  // Pestaña espejo del espacio de trabajo de apps del agente
  'workspace.tab.tag': 'App',
  'workspace.tab.running': 'El agente está manejando su app en un escritorio oculto',
  // Tarea 7 — hay que decir siempre que se usó el bypass de toolchain (diseño F5); no es un estado
  // estable, así que se traduce aunque el resto de chat.notice.* todavía no esté aquí
  'chat.notice.bypassed': 'Iniciada omitiendo la configuración de toolchain de esta carpeta — puede no ser la versión que fijaste',
  'remote.session.readOnly': 'Este Runtime está emparejado en solo lectura, así que esta sesión no acepta entrada desde aquí.',
  'remote.session.reconnecting': 'Reconectando con el Runtime. La sesión sigue en marcha allí.',
  'remote.session.gone': 'No se puede recibir la salida de esta sesión: {message}',
  'remote.session.ended': 'La sesión terminó (código {code})',
  'remote.session.sizedHost': 'Se muestra con el tamaño de ventana del equipo host. Escribe aquí para usar el tamaño de esta ventana.',
  'remote.session.sizedOther': 'Se muestra con el tamaño de ventana de otro equipo remoto. Escribe aquí para usar el tamaño de esta ventana.',
  'remote.session.sizedHostFixed': 'Se muestra con el tamaño de ventana del equipo host.',
  'remote.session.noPty': 'el Runtime aún no ha indicado el terminal de esta sesión',
  'remote.session.readOnlyAnswer': 'Esta sesión espera una respuesta, pero un emparejamiento de solo lectura no puede darla desde aquí.',
  'remote.session.notReadable': 'La conversación de esta sesión aún no se puede leer en el Runtime.',
  'remote.session.status.working': 'Trabajando',
  'remote.session.status.waiting': 'Esperando',
  'remote.session.status.idle': 'Inactiva',
  'remote.session.status.unknown': 'Estado desconocido',
  'remote.session.earlier': 'Anteriores',
  'remote.session.chatEnded': 'Esta sesión terminó en el Runtime.',
  'remote.session.composer': 'Un mensaje para la sesión en el Runtime',
  'remote.session.inputLost': 'Lo que acabas de escribir no llegó al Runtime. Vuelve a escribirlo cuando vuelva la conexión.',
  'tabs.recent.title': 'Cerradas recientemente',
  'tabs.recent.running': 'en marcha',
  'tabs.recent.ended': 'terminada',
  'wall.end.title': '¿Terminar {name}?',
  'wall.end.body': 'Esta consola sigue en marcha. Terminarla detiene su proceso.',
  'wall.end.confirm': 'Terminar sesión',
  'summary.facts.questions': 'preguntas: {n} (agente principal {coordinator}, tú {owner})',
  'summary.role.worker': 'Agente',
  'tabs.strip.label': 'Pestañas abiertas',
  'conversation.completion.label': 'Sugerencias',
  'agents.view.idle': 'Inactivas',
  'agents.view.empty': 'No hay sesiones en marcha en este proyecto. Empieza una con el botón + o un Nuevo plan.',
  'agents.view.planEmpty': 'Todavía no hay consolas en {name}.',
  'agents.view.open': 'Abrir una consola',
  'agents.view.filter': 'Filtrar por plan',
  'agents.row.open': 'Abrir',
  'agents.row.side': 'Abrir al lado',
  'agents.row.plan': 'Ir al plan',
  'agents.row.rename': 'Renombrar',
  'agents.row.stop': 'Detener',
  'agents.row.started': 'Iniciada: {when}',
  'agents.row.lastActive': 'Última actividad: {when}',
  'agents.header.label': 'Consola',
  'agents.header.plan': 'Abrir el plan {name}',
  'agents.header.task': 'Ver la tarea {name} en el plan',
  'agents.header.restart': 'Reiniciar',
  'session.terminal.resume': 'Reanudar conversación',
  'session.terminal.fresh': 'Empezar de cero',
  'session.terminal.closeTab': 'Cerrar pestaña',
  'session.terminal.switchNow': 'Cambiar de cuenta ahora',
  'agents.header.folder': 'Acciones de carpeta',
  'agents.header.openFolder': 'Abrir carpeta',
}
