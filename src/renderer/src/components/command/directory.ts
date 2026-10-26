// W3-B: the resolver's view of orchestration data (core/intents/resolve.ts), folded from the workspace sidebar's own
// tree (W2-B) so a "worker three" here is the "Worker 3" the sidebar shows.
import type { Directory, Pins } from '../../../../core/intents/resolve'
import type { Intent } from '../../../../core/intents/types'
import type { MessageKey } from '../../../../core/i18n'
import type { ActionId } from '../../../../core/keys/binding'
import { ACTIVITY_IDS, PANEL_TABS } from '../../../../core/ui/pages'
import type { ThemeId } from '../../../../core/theme/themes'
import { isOwnerHeld } from '../plan/planList'
import { planSessions, type WorkspaceData, type WorkspaceProject } from '../../state/workspaceTree'
import { setHelpOpen } from '../help/helpStore'
import { openActivity, openConsole, openPanel, openPlan, openView, toggleSideBar, togglePanel } from '../shell/navigation'

export function directoryOf(
  tree: readonly WorkspaceProject[],
  data: WorkspaceData | null,
  currentProjectPath: string | null,
  currentPlanId: string | null
): Directory {
  const jobs = new Map(Object.values(data?.jobsByProject ?? {}).flat().map((j) => [j.id, j]))
  return {
    projects: tree.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    plans: tree.flatMap((p) =>
      p.plans
        .filter((pl) => !pl.archived)
        .map((pl) => {
          const job = jobs.get(pl.jobId)
          return {
            jobId: pl.jobId,
            name: pl.name,
            projectId: p.id,
            projectName: p.name,
            projectPath: p.path,
            scheduled: job?.schedule !== undefined,
            pendingStart: job?.pendingStart === true,
            ...(job && isOwnerHeld(job) ? { held: true } : {}),
            ...(pl.runId !== undefined ? { runId: pl.runId } : {}),
            sessions: planSessions(pl).map((x) => ({
              sessionId: x.sessionId,
              role: x.role,
              label: x.label,
              ...(x.taskTitle !== undefined ? { taskTitle: x.taskTitle } : {})
            }))
          }
        })
    ),
    currentProjectPath,
    currentPlanId
  }
}

// DESIGN-W13 §9: the command palette's commands (Ctrl+Shift+P). Each is a name in a category, optionally the key action
// whose chord the row shows, and a handler; the handler goes through navigation.ts like every other way into a view.

export type CommandCategory = 'view' | 'plan' | 'console' | 'preferences' | 'help'
export const COMMAND_CATEGORIES: readonly CommandCategory[] = ['view', 'plan', 'console', 'preferences', 'help']

/** A second list a command opens in the palette (pick a plan, a console, a theme). `preview` runs as a row is
 *  highlighted; `cancel` runs when the palette closes without a pick. */
export interface PaletteStage {
  title: string
  rows: Array<{ key: string; label: string; detail?: string; current?: boolean; preview?: () => void; pick: () => void }>
  cancel?: () => void
}

export interface PaletteCx {
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  /** The plan open in the workspace. */
  currentPlanId: string | null
  plans: Directory['plans']
  /** Run an intent the way the box would, on this plan (pause and resume go through the coordinator's own path). */
  intent: (intent: Intent, pins: Pins) => void
  theme: { current: ThemeId; ids: readonly ThemeId[]; name: (id: ThemeId) => string; preview: (id: ThemeId) => void; commit: (id: ThemeId) => void }
}

export interface PaletteCommand {
  id: string
  category: CommandCategory
  label: MessageKey
  /** `{name}` of the label, an i18n key too. */
  name?: MessageKey
  /** The key action whose chord (binding.ts) the row shows at its right. */
  action?: ActionId
  run: (cx: PaletteCx) => PaletteStage | void
}

/** The plan a command acts on: the open one, else a list to pick from. */
function onPlan(title: string, cx: PaletteCx, go: (jobId: string) => void): PaletteStage | void {
  if (cx.currentPlanId !== null && cx.plans.some((p) => p.jobId === cx.currentPlanId)) return go(cx.currentPlanId)
  return { title, rows: cx.plans.map((p) => ({ key: p.jobId, label: p.name, detail: p.projectName, pick: () => go(p.jobId) })) }
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  ...ACTIVITY_IDS.map(
    (id): PaletteCommand => ({ id: `view.activity.${id}`, category: 'view', label: 'palette.show', name: `shell.activity.${id}` as MessageKey, action: `activity.${id}`, run: () => openActivity(id) })
  ),
  { id: 'view.sidebar', category: 'view', label: 'palette.toggleSideBar', action: 'sidebar.toggle', run: () => toggleSideBar() },
  { id: 'view.panel', category: 'view', label: 'palette.togglePanel', action: 'panel.toggle', run: () => togglePanel() },
  ...PANEL_TABS.map(
    (tab): PaletteCommand => ({ id: `view.panel.${tab}`, category: 'view', label: 'palette.show', name: `shell.panel.${tab}` as MessageKey, run: () => openPanel(tab) })
  ),
  { id: 'plan.new', category: 'plan', label: 'palette.newPlan', run: () => openView('start') },
  { id: 'plan.main', category: 'plan', label: 'palette.mainPlan', run: () => openView('mainplan') },
  {
    id: 'plan.settings',
    category: 'plan',
    label: 'palette.planSettings',
    run: (cx) => onPlan(cx.t('palette.pickPlan'), cx, (jobId) => openPlan(jobId, 'settings'))
  },
  { id: 'plan.pause', category: 'plan', label: 'palette.pausePlan', run: (cx) => onPlan(cx.t('palette.pickPlan'), cx, (jobId) => cx.intent({ kind: 'pause' }, { planId: jobId })) },
  { id: 'plan.resume', category: 'plan', label: 'palette.resumePlan', run: (cx) => onPlan(cx.t('palette.pickPlan'), cx, (jobId) => cx.intent({ kind: 'resume' }, { planId: jobId })) },
  {
    id: 'console.open',
    category: 'console',
    label: 'palette.openConsole',
    run: (cx) => ({
      title: cx.t('palette.pickConsole'),
      rows: cx.plans.flatMap((p) => p.sessions.map((s) => ({ key: s.sessionId, label: s.label, detail: `${p.projectName} › ${p.name}`, pick: () => openConsole(s.sessionId) })))
    })
  },
  { id: 'preferences.settings', category: 'preferences', label: 'palette.openSettings', action: 'settings.open', run: () => openView('settings') },
  { id: 'preferences.keys', category: 'preferences', label: 'palette.keyboardShortcuts', run: () => openView('settings', 'keys') },
  {
    id: 'preferences.theme',
    category: 'preferences',
    label: 'palette.colorTheme',
    run: (cx) => ({
      title: cx.t('palette.pickTheme'),
      rows: cx.theme.ids.map((id) => ({ key: id, label: cx.theme.name(id), current: id === cx.theme.current, preview: () => cx.theme.preview(id), pick: () => cx.theme.commit(id) })),
      cancel: () => cx.theme.preview(cx.theme.current)
    })
  },
  { id: 'help.show', category: 'help', label: 'palette.showHelp', action: 'help.open', run: () => setHelpOpen(true) }
]
