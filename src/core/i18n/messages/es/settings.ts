// Spanish · settings area. Which files each area serves: ../README.md.
import type { settings as ko } from '../ko/settings'

export const settings: Partial<Record<keyof typeof ko, string>> = {
  'settings.tab.creativeHub': 'Creative Hub',
  'settings.tab.shortcuts': 'Atajos',
  'settings.tab.history': 'Historial',
  'settings.tab.remote': 'Runtimes remotos',
  // Modo de permisos del agente
  'settings.agentPermission.label': 'Ejecutar agentes sin comprobar permisos',
  'settings.agentPermission.hint':
    'Todas las sesiones de agente que inicia la aplicación se ejecutan sin preguntar por permisos ' +
    '(--dangerously-skip-permissions para claude, --dangerously-bypass-approvals-and-sandbox para codex). ' +
    'Desactivado de forma predeterminada. Un worker de Job siempre arranca en un worktree recién creado: esa ' +
    'carpeta no tiene historial de aprobaciones y la lista de permitidos acumulada en el proyecto ' +
    '(.claude/settings.local.json) no lo acompaña, así que al desactivarlo el worker se detiene en su primer comando. ' +
    'Las sesiones ya abiertas no se ven afectadas. Se aplica a partir de la siguiente sesión.',
  'settings.agentPermission.saveFailed': 'No se pudo guardar el modo de permisos: {detail}',
  // Seguimiento de unidades de trabajo
  'settings.workUnit.label': 'Seguimiento de unidades de trabajo',
  'settings.workUnit.hint':
    'Declara una tarea escribiendo /astera-task con lo que quieres hacer, y eso se convierte en una ' +
    'fila propia hasta que termina, sin importar cuántos mensajes haga falta. Solo funciona en un ' +
    'proyecto que sea un repositorio de git. No se aplica a las ' +
    'sesiones que ya están abiertas: funciona a partir de las sesiones nuevas. Solo se leen las ' +
    'conversaciones posteriores a activarlo — el historial existente nunca se lee.',
  'settings.workUnit.saveFailed': 'No se pudo guardar la configuración de seguimiento: {detail}',
  // Navegador del agente
  'settings.agentBrowser.label': 'Navegador del agente',
  'settings.agentBrowser.hint':
    'Activado, cada sesión tiene su propia pestaña de vista previa para abrir, recargar y leer los errores de consola del servidor de desarrollo de este proyecto. ' +
    'Instala la habilidad astera-browser en todas las cuentas. Solo se puede abrir localhost. ' +
    'No afecta a las sesiones ya abiertas; sí a las nuevas.',
  'settings.agentBrowser.saveFailed': 'No se pudo guardar el ajuste del navegador del agente: {detail}',
  // Espacio de trabajo de apps del agente
  'settings.agentApp.label': 'Espacio de trabajo de apps del agente',
  'settings.agentApp.hint':
    'Activado, un agente puede abrir la app de este proyecto donde usted no la ve (un escritorio oculto en Windows, una pantalla virtual en Linux, en segundo plano en macOS), manejarla y fotografiarla. ' +
    'Nunca toma su pantalla ni su puntero. En Windows y macOS comparte su portapapeles. Instala la habilidad astera-app en todas las cuentas. ' +
    'No afecta a las sesiones ya abiertas; sí a las nuevas.',
  'settings.agentApp.saveFailed': 'No se pudo guardar el ajuste del espacio de trabajo de apps del agente: {detail}',
  // Generación de explicaciones (How It Works)
  'settings.gen.label': 'Cuenta para explicaciones',
  'settings.gen.hint': 'Cuando termina un trabajo, esta cuenta escribe la explicación de la función. No se genera nada hasta que elijas una.',
  'settings.gen.none': 'Sin elegir — no se genera nada',
  'settings.gen.model': 'Modelo',
  'settings.gen.modelDefault': 'El predeterminado del CLI',
  'settings.gen.effort': 'Profundidad de razonamiento',
  'settings.gen.effortDefault': 'El predeterminado del modelo',
  'settings.gen.refresh': 'Actualizar la lista de modelos',
  'settings.gen.loading': 'Consultando los modelos…',
  'settings.gen.listFailed': 'No se pudo obtener la lista de modelos — puedes escribir uno. ({detail})',
  'settings.gen.modelPlaceholder': 'Escribe el nombre de un modelo',
  'settings.gen.saveFailed': 'No se pudo guardar la configuración de generación: {detail}',
  'common.or': 'o',
  // App.tsx — settings modal Info/Slack/Worktree tabs, CLI-not-found screen
  'settings.info.appName': 'Nombre de la aplicación',
  'settings.info.version': 'Versión',
  'settings.info.registeredAccounts': 'Cuentas registradas',
  'settings.info.update': 'Actualización',
  'settings.info.host': 'Host en segundo plano',
  'settings.info.hostConnected': 'Conectado · protocolo {protocol} · desde hace {uptime}',
  'settings.info.hostNotConnected': 'Sin conexión',
  'settings.info.hostNotConnectedWhy': 'Sin conexión · {detail}',
  'settings.worktree.createLocation': 'Ubicación de los worktrees nuevos',
  'settings.worktree.change': 'Cambiar…',
  'settings.worktree.hint':
    'Los worktrees nuevos se crean bajo esta carpeta como <repo>/<nombre>. Los worktrees existentes no se mueven.',
  'settings.history.hiddenProjects': 'Proyectos ocultos',
  'settings.history.unhide': 'Mostrar',
  'settings.history.empty': 'No hay proyectos ocultos.',
  'settings.history.search': 'Buscar rutas…',
  'settings.history.noMatch': 'No hay proyectos que coincidan.',
  'settings.history.total': '{count} en total',
  'settings.history.prevPage': 'Página anterior',
  'settings.history.nextPage': 'Página siguiente',
  'settings.history.selectAll': 'Seleccionar todo',
  'settings.history.deleteSelected': 'Eliminar historial ({count})',
  'settings.history.deleteTitle': '¿Eliminar el historial de los proyectos seleccionados?',
  'settings.history.deleteBody':
    'Mueve {count} historiales de conversación a la papelera. Las carpetas del proyecto y sus archivos no se eliminan.\n\n{list}',
  'settings.history.deleteConfirm': 'Mover a la papelera',
  'settings.history.deleteDone': 'Se movieron {count} historiales a la papelera.',
  'settings.history.deleteBusy': 'Se omitieron {count}: {name} está en ejecución.',
  'settings.history.deleteFailed': 'No se pudieron eliminar {count}.',
  // ThemeSettings.tsx — the theme card grid
  'settings.theme.label': 'Tema',
  'settings.theme.hint':
    'Night, Dusk y Day solo cambian los colores; Sistema sigue al sistema operativo (claro → Day, oscuro → Night). La fuente del terminal se elige aparte, más abajo.',
  'settings.theme.system': 'Sistema',
  'settings.theme.saveFailed': 'No se pudo guardar el tema: {detail}',
  // ResumeStrategySettings.tsx — the two-way resume strategy picker
  'settings.resumeStrategy.label': 'Estrategia de reanudación de sesión',
  'settings.resumeStrategy.smart.label': 'Reanudación inteligente',
  'settings.resumeStrategy.smart.hint': 'Continúa la conversación solo con un punto de control compacto. Si el agente dejó una nota de traspaso mientras trabajaba, también se entrega.',
  'settings.resumeStrategy.original.label': 'Reanudar la sesión original',
  'settings.resumeStrategy.original.hint': 'Continúa la conversación con el resume propio del CLI.',
  'settings.resumeStrategy.saveFailed': 'No se pudo guardar la estrategia de reanudación: {detail}',
  'settings.jobContinuity.label': 'Continuidad de trabajos',
  'settings.jobContinuity.hint':
    'Mantiene los trabajos recuperables tras fallos y reinicios. ' +
    'Usa el estado duradero del trabajo, la recuperación de la sesión nativa y la reanudación inteligente cuando hace falta.',
  'settings.jobContinuity.smartResumeTurnedOn':
    'Continuidad de trabajos activada. La reanudación inteligente también se activó para una recuperación automática completa.',
  'settings.jobContinuity.turnOffSmartResume.title': '¿Desactivar la reanudación inteligente?',
  'settings.jobContinuity.turnOffSmartResume.body':
    'La continuidad de trabajos seguirá activada, pero un trabajo puede detenerse cuando no se pueda recuperar su sesión original de Claude Code o Codex.',
  'settings.jobContinuity.turnOffSmartResume.confirm': 'Desactivar',
  'settings.jobContinuity.saveFailed': 'No se pudo guardar el ajuste de continuidad de trabajos: {detail}',
  // TerminalFontSettings.tsx — the terminal font picker rows
  'settings.font.latin': 'Fuente latina del terminal',
  'settings.font.hangul': 'Fuente hangul del terminal',
  'settings.font.system': 'Predeterminada del sistema',
  'settings.font.notInstalled': 'no instalada',
  'settings.font.sample': 'AaBb 한글 123',
  'settings.font.hangulShadowed':
    'La fuente latina seleccionada también dibuja el hangul, así que la fuente de hangul no tiene efecto.',
  'settings.font.listFailed': 'No se pudo obtener la lista de fuentes instaladas: {detail}',
  'settings.font.saveFailed': 'No se pudo guardar la configuración de fuentes: {detail}',
  'settings.font.checkingHangul': 'comprobando las fuentes instaladas…',
  'settings.font.loadingList': 'leyendo las fuentes instaladas…',
  'update.info.restartInstallVersion': 'Reiniciar e instalar v{version}',
  'update.info.checking': 'Comprobando…',
  'update.info.checkButton': 'Comprobar actualizaciones',
  'update.info.upToDateAt': 'Ya tiene la última versión (comprobado {time})',
  // 'available' means "found", not "downloading"
  'update.info.available': 'Nueva versión {version} disponible',
  'update.info.downloadVersion': 'Descargar {version}',
  'update.info.checkFailed': 'Error al comprobar',
  'update.info.manualInstallVersion': 'Instalar v{version} a mano',
  'update.info.manualWhy': 'Esta versión no puede instalarse sola: hay que moverla a mano',
  'update.info.manualOnly': 'Esta versión no se actualiza sola: actualiza el código y vuelve a compilar',
  'update.ui.build': 'Compilación',
  'update.ui.checkedAt': 'comprobado {time}',
  'update.ui.upToDate': 'Al día',
  'update.ui.changes': 'Cambios nuevos: {count}',
  'update.ui.ready': 'Actualización compilada — cambios: {count}',
  'update.ui.buildNow': 'Compilar ahora',
  'update.ui.lastError': 'Último error: {message}',
  'update.ui.showChanges': 'Ver cambios ({count})',
  'update.ui.hideChanges': 'Ocultar cambios',
  'update.ui.moreChanges': '…y {count} más',
  // App.tsx — settings modal Shortcuts tab
  'shortcut.group.terminal': 'Terminal',
  'shortcut.terminal.newline': 'Salto de línea',
  'shortcut.terminal.copyOrInterrupt': 'Copiar selección · interrumpir si no hay',
  'shortcut.paste': 'Pegar',
  'shortcut.group.sessionTab': 'Pestañas de sesión',
  'shortcut.gesture.tabDrag': 'Arrastrar la pestaña',
  'shortcut.sessionTab.reorder': 'Reordenar',
  'shortcut.group.pane': 'Paneles',
  // ShortcutSettings.tsx — the editable shortcut list
  'shortcut.group.editable': 'Personalizables',
  'shortcut.edit': 'Cambiar',
  'shortcut.resetOne': 'Predeterminado',
  'shortcut.capturing': 'Presione una tecla (Esc para cancelar)',
  'shortcut.unbound': 'Ninguno',
  'shortcut.conflictWith': '{key} ya se usa en "{action}"',
  'shortcut.riskTitle': 'Asignar {key} como atajo de la aplicación',
  'shortcut.riskConfirm': 'Asignar igualmente',
  'shortcut.pane.dragSplit': 'Al borde para dividir · al centro para mover',
  'shortcut.group.explorer': 'Explorador de archivos',
  'shortcut.explorer.saveFile': 'Guardar el archivo',
  'shortcut.explorer.rename': 'Cambiar nombre',
  'shortcut.explorer.delete': 'Eliminar',
  'shortcut.explorer.selectAll': 'Seleccionar todo',
  'shortcut.explorer.cut': 'Cortar',
  'shortcut.explorer.copy': 'Copiar',
  'shortcut.gesture.itemDrag': 'Arrastrar el elemento',
  'shortcut.explorer.move': 'Mover · con {mod}, copiar',
  'shortcut.explorer.undo': 'Deshacer',
  'settings.freshCoordinator.label': 'Coordinador nuevo al llegar al contexto (%)',
  'settings.freshCoordinator.hint': 'Cuando el coordinador de un plan ha usado esta parte de su ventana de contexto, Astera lo sustituye por una sesión nueva (misma cuenta y modelo) informada con el estado del plan. También se sustituye en cada cambio de oleada. 0 desactiva la comprobación de contexto.',
  'settings.freshCoordinator.saveFailed': 'No se pudo guardar el ajuste del coordinador nuevo: {detail}',
  'settings.stallWatch.label': 'Vigilar planes detenidos',
  'settings.stallWatch.hint': 'Cada 30 segundos Astera revisa cada plan en marcha: una Task lista sin empezar durante 2 minutos con un hueco libre, un coordinador ocupado durante minutos sin empezar nada, una Task completada que no está en la rama del plan, un PR borrador que no se abrió tras una oleada. Avisa al coordinador o lo arregla él mismo, con una línea en el feed por acción. Nunca cancela trabajo ni fusiona en main.',
  'settings.stallWatch.saveFailed': 'No se pudo guardar el ajuste de vigilancia de planes detenidos: {detail}',
  'settings.startAtLogin.label': 'Iniciar Astera al iniciar sesión',
  'settings.startAtLogin.hint': 'Inicia Astera en segundo plano al iniciar sesión, para que los planes interrumpidos por un fallo o reinicio continúen donde se quedaron antes de abrir la ventana. Solo Linux.',
  'settings.startAtLogin.saveFailed': 'No se pudo guardar el ajuste de inicio al iniciar sesión: {detail}',
  'settings.autoAnswer.label': 'Responder preguntas automáticamente',
  'settings.autoAnswer.hint': 'Astera responde por sí mismo las preguntas de un plan cuando puede hacerlo con seguridad: con lo que sabe (si una Task se fusionó, si una oleada terminó) o con la recomendación de quien pregunta o la opción segura (esperar, retener, reintentar una vez, saltar la comprobación). Una línea en el feed por respuesta. Borrar trabajo, enviar o fusionar en la rama principal, dinero, credenciales y permisos siempre te llegan a ti.',
  'settings.autoAnswer.saveFailed': 'No se pudo guardar el ajuste de respuestas automáticas: {detail}',
  // W9-E settings page
  'settings.group.general': 'General',
  'settings.group.agents': 'Agentes',
  'settings.group.projects': 'Proyectos',
  'settings.group.integrations': 'Integraciones',
  'settings.group.notifications': 'Notificaciones',
  'settings.group.advanced': 'Avanzado',
  'settings.basic.advancedMode.label': 'Modo avanzado',
  'settings.basic.advancedMode.hint': 'Muestra todos los ajustes, y el gráfico, el diario y otras partes técnicas de un plan.',
  'settings.basic.showAdvanced': 'Mostrar ajustes avanzados',
  'settings.basic.hideAdvanced': 'Ocultar ajustes avanzados',
  'settings.search.placeholder': 'Buscar ajustes',
  'settings.search.empty': 'Ningún ajuste coincide con "{query}"',
  'settings.back': 'Atrás',
  'settings.row.github': 'GitHub',
  'settings.row.cli': 'CLI (el comando astera)',
  'settings.row.mcp': 'MCP',
  'settings.row.cliVersions': 'Claude Code y Codex CLI',
  // Machine-aware worker cap: the recommendation for this machine and the warning above it
  'settings.maxWorkers.recommended': 'Recomendado para esta máquina: {count} (memoria {memory} GB, {cores} núcleos)',
  'settings.maxWorkers.overRecommended': 'Por encima de los {count} que esta máquina probablemente maneja: los agentes pueden ir más lentos o el sistema puede quedarse sin memoria.',
  'onboarding.settings.replay': 'Mostrar la bienvenida de nuevo',
  'onboarding.settings.replayHint': 'Recorre la configuración desde el principio. Tus ajustes no cambian.',
  'onboarding.settings.replayButton': 'Mostrar',
}
