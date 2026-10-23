// Spanish · worktrees area. Which files each area serves: ../README.md.
import type { worktrees as ko } from '../ko/worktrees'

export const worktrees: Partial<Record<keyof typeof ko, string>> = {
  'session.new.starting': 'Iniciando la sesión…',
  'session.new.startingWorktree': 'Creando el worktree…',
  'session.new.stage.fetch': 'Obteniendo la rama base…',
  'session.new.stage.checkout': 'Extrayendo los archivos…',
  'session.new.stage.copyIncludes': 'Copiando los archivos incluidos…',
  'session.new.stage.copyCount': '{copied} / {total} · {files} / {filesTotal} archivos',
  'session.new.cancelling': 'Cancelando…',
  // worktrees/useWorktrees.tsx, views/ScmView.tsx — status labels
  'worktree.status.orphanDir': 'Registro de git perdido',
  'worktree.status.unreachable': 'Carpeta no accesible',
  'worktree.status.gitUnchecked': 'No se pudo comprobar git',
  // worktrees/useWorktrees.tsx, views/ScmView.tsx — delete confirmation modal, result toasts
  'worktree.remove.title': 'Eliminar worktree',
  'worktree.remove.body':
    '{name} ({branch})\n{path}\n\n¿Eliminar este worktree? Se eliminan juntas la carpeta y la rama. Una rama sin fusionar se conserva para no perder sus commits.',
  'worktree.remove.branchPreserved': 'La rama {branch} no estaba fusionada, así que se conservó',
  'worktree.remove.done': 'Se eliminó el worktree',
  'worktree.remove.alreadyGone': '{name} ya se había eliminado, así que se quitó de la lista',
  // Shown on the row while deleting
  'worktree.remove.removing': 'Eliminando…',
  // worktrees/useWorktrees.tsx, views/ScmView.tsx — force-delete second confirmation
  'worktree.forceRemove.unverifiableTitle': 'No se puede comprobar si hay cambios',
  'worktree.forceRemove.dirtyTitle': 'Cambios sin confirmar',
  'worktree.forceRemove.unverifiableBody':
    'git ya no rastrea {name}, así que no se puede saber si hay cambios sin confirmar.\n{path}\nSi fuerza la eliminación, se perderá el contenido de la carpeta. Ábrala y compruébelo antes de continuar.',
  'worktree.forceRemove.dirtyBody':
    '{name} tiene {count} cambios sin confirmar.\nSi fuerza la eliminación, se perderán esos cambios. ¿Continuar?',
  'worktree.forceRemove.confirm': 'Forzar eliminación',
  // worktrees/useWorktrees.tsx, views/ScmView.tsx — panel header, row icon buttons
  'worktree.refresh': 'Actualizar',
  'worktree.action.startSession': 'Nueva sesión',
  'worktrees.hint': 'Un worktree es una carpeta aparte del mismo repositorio con su propia rama, para que un agente trabaje sin tocar tus archivos.',
  'worktrees.helpLabel': '¿Qué es un worktree?',
  'worktrees.gone': 'Este worktree ya no está en la lista.',
  'worktrees.menu.openExplorer': 'Abrir en el Explorador',
  'worktrees.changesPane': 'Cambios',
  'worktrees.changesPick': 'Elige un worktree para ver sus cambios.',
  'worktrees.aheadBehind': '{ahead} por delante, {behind} por detrás',
  'worktrees.rowMenu': 'Acciones del worktree',
  'worktrees.prMenu': 'Acciones de la pull request',
}
