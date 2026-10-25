// What the workbench tab menu and the Agents view rows offer, decided apart from the JSX (house pattern:
// plan/planHeaderActions.ts). Overlays.tsx and AgentsView.tsx turn the ids into items; effects live in tabActions.ts.

export type TabMenuKind = 'local' | 'remote' | 'browser' | 'file' | 'other'
export type TabAction = 'rename' | 'stop' | 'restart' | 'duplicate' | 'moveAccount' | 'copyId' | 'copyPath' | 'copyRelativePath' | 'reveal'

export type TabActionInput = {
  kind: TabMenuKind
  /** A local session whose process has ended. */
  exited?: boolean
  /** A file tab with a path under the project root, so a relative path exists. */
  relative?: boolean
}

/** The actions for one tab, in two groups: what to do with the session, then what to copy or reveal. */
export function tabActions({ kind, exited, relative }: TabActionInput): { manage: TabAction[]; path: TabAction[] } {
  switch (kind) {
    case 'local':
      return {
        manage: ['rename', exited ? 'restart' : 'stop', 'duplicate', ...(exited ? [] : (['moveAccount'] as const))],
        path: ['copyId', 'copyPath', 'reveal']
      }
    case 'remote':
      return { manage: [], path: ['copyId'] }
    case 'file':
      return { manage: [], path: ['copyPath', ...(relative ? (['copyRelativePath'] as const) : []), 'reveal'] }
    default:
      return { manage: [], path: [] }
  }
}

/** `path` relative to `root` when it lies under it, else null. Either separator, as a Windows path has. */
export function relativeUnder(root: string | null | undefined, path: string): string | null {
  if (!root) return null
  const base = root.replace(/[\\/]+$/, '')
  if (path.length <= base.length + 1 || !path.startsWith(base) || !/[\\/]/.test(path[base.length])) return null
  return path.slice(base.length + 1)
}

/** The tabs each Close entry shuts, for the right-clicked tab `tid` in its group's `tabIds`. */
export function closeTargets(tabIds: string[], tid: string): { others: string[]; right: string[]; all: string[] } {
  const i = tabIds.indexOf(tid)
  return { others: tabIds.filter((x) => x !== tid), right: i < 0 ? [] : tabIds.slice(i + 1), all: [...tabIds] }
}

/** Closes tabs one after another. A close can ask (an unsaved file, a running console), and only one question
 *  can be open at a time, so each close waits for its question to be answered before the next starts. A tab whose
 *  question is declined stays open; the rest still close. */
export async function closeInSequence(ids: string[], close: (id: string) => void, isAsking: () => boolean): Promise<void> {
  for (const id of ids) {
    close(id)
    await new Promise<void>((r) => setTimeout(r, 0))
    while (isAsking()) await new Promise<void>((r) => setTimeout(r, 50))
  }
}
