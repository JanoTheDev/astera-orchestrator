// W9-E Start page rules (DESIGN §2 "Start"). Pure, so the node tests cover them; StartPage.tsx keeps the state.
import type { IntakeTab } from '../intake/intakeRequest'
import type { ScheduleRule } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS, PROJECT_DEFAULTS, type DeliveryMode, type Job, type Project } from '../../../../core/orchestration/types'
import { isEffort, type Effort } from '../../../../core/orchestration/roleModels'
import { jobNameOf } from '../../../../core/orchestration/jobName'
import type { Account, AccountUsage } from '../../../../core/types'
import { providerOf } from '../../../../core/providers/meta'

/** T14: the three plain ways to start. `chat`: the planner talks the plan through with the person; `auto`: it plans and
 *  starts on its own (auto-approve); `prompts`: each prompt runs as written (W8-C `--mode prompts`, no planner). */
export type StartMode = 'chat' | 'auto' | 'prompts'

export const START_MODES: readonly StartMode[] = ['chat', 'auto', 'prompts']

/** What Start opens with: from New, a window drop, or a new project's first plan. */
export interface StartRequest {
  mode?: StartMode
  files?: string[]
  text?: string
  /** The project folder; the current project when absent. */
  cwd?: string
}

/** The attachments a composer chip shows: prompt and note files, PDFs and images (DESIGN §2). */
const ATTACHABLE = /\.(md|markdown|txt|pdf|png|jpe?g|gif|webp|svg)$/i
const PROMPT_FILE = /\.(md|markdown)$/i

/** The one W6-A intake tab Start's composer amounts to. */
export function intakeTab({ mode, files }: { mode: StartMode; files: string[] }): IntakeTab {
  if (mode === 'prompts') return mode
  return files.length > 0 ? 'files' : 'describe'
}

/** How many Tasks Run as written makes: one per prompt file, else one per `##` section of the pasted document. */
export function promptCount(files: string[], text: string): number {
  const md = files.filter((f) => PROMPT_FILE.test(f)).length
  if (files.length > 0) return md
  return text.split('\n').filter((l) => /^##\s/.test(l)).length || (text.trim() ? 1 : 0)
}

type T = (key: string, params?: Record<string, string | number>) => string

/** The primary button follows the mode: "Start planning", "Plan and start" or "Run prompts" (with "3 files → 3 tasks"). */
export function primaryLabel(
  { mode, files, text, after, named }: { mode: StartMode; files: string[]; text: string; after?: string; named?: number },
  t: T
): { label: string; note?: string } {
  if (after) return { label: t('start.go.queue', { plan: after }) }
  if (mode === 'chat') return { label: t('start.go.plan') }
  if (mode === 'auto') return { label: t('start.go.auto') }
  // W10-A: prompt names typed with nothing attached count the files they resolved to
  if (named !== undefined && files.length === 0) return { label: t('start.go.prompts'), note: t('start.go.namesNote', { n: named }) }
  const n = promptCount(files, text)
  return {
    label: t('start.go.prompts'),
    note: n === 0 ? undefined : t(files.length > 0 ? 'start.go.filesNote' : 'start.go.sectionsNote', { n })
  }
}

/** A project with no plans and no consoles lands on Start instead of an empty wall. */
export const shouldLandOnStart = ({ plans, consoles }: { plans: number; consoles: number }): boolean => plans === 0 && consoles === 0

const norm = (p: string, fold: boolean): string => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return fold ? s.toLowerCase() : s
}

/** The consoles working in the project's folder or below it. */
export function consolesIn(sessions: { cwd: string }[], root: string, foldCase = false): number {
  const r = norm(root, foldCase)
  return sessions.filter((s) => {
    const c = norm(s.cwd, foldCase)
    return c === r || c.startsWith(`${r}/`)
  }).length
}

/** The paths of the dropped files Start can attach. */
export function filesFromDrop(list: ArrayLike<{ name: string }> | null | undefined, pathFor: (f: never) => string): string[] {
  if (!list) return []
  return Array.from(list)
    .filter((f) => ATTACHABLE.test(f.name))
    .map((f) => pathFor(f as never))
    .filter((p) => p !== '')
}

/** A window drop opens Start only when it carries files Start takes and no other handler took it first (terminals,
 *  the explorer, the editor and open dialogs handle their own drops). */
export const dropOpensStart = (e: { defaultPrevented: boolean; files: string[] }): boolean => !e.defaultPrevented && e.files.length > 0

// W10-A Run as written by name
/** What `jobs-create --dry-run` answers for the typed prompt names (promptNames.ts `PromptResolution`). */
export interface NameLookup {
  names: boolean
  dir?: string | null
  detected?: boolean
  picked?: { id: string; path: string }[]
  skipped?: { id: string; why: string }[]
  why?: string[]
  problems?: string[]
}

/** The dry run Start asks for while Run as written has text: the attached prompt files with it, so the Host can say
 *  the names are ignored. Null when there is nothing to look up. */
export function lookupArgs({ mode, files, text, cwd }: { mode: StartMode; files: string[]; text: string; cwd: string }): Record<string, unknown> | null {
  if (mode !== 'prompts' || text.trim() === '') return null
  // `--mode prompts` takes .md files only
  const md = files.filter((f) => /\.md$/i.test(f))
  return { cwd, mode: 'prompts', objective: text, dryRun: true, ...(md.length > 0 ? { attach: md } : {}) }
}

const DELIVERY_MODES: readonly DeliveryMode[] = ['merge', 'push', 'pr', 'manual']

/** Why the primary button is off, as the one line beside it: no project, nothing written yet. Null when it can go. */
export function blockedReason({ project, text, request }: { project: boolean; text: boolean; request: boolean }, t: T): string | null {
  if (!project) return t('start.project.required')
  return text && request ? null : t('start.needText')
}

/** The planning the intake sends for a mode: `chat` talks it through, `auto` and the planner-less `prompts` do not. */
export const planningOf = (mode: StartMode): 'chat' | 'auto' => (mode === 'chat' ? 'chat' : 'auto')

// T14 the project's last choice
export const modeKey = (projectId: string): string => `astera.start.mode.${projectId}`

/** The mode this project last started with; null when none was saved (or storage is unavailable). */
export function lastMode(projectId: string): StartMode | null {
  try {
    const v = window.localStorage.getItem(modeKey(projectId))
    return START_MODES.find((m) => m === v) ?? null
  } catch {
    return null
  }
}

export function saveMode(projectId: string, mode: StartMode): void {
  try {
    window.localStorage.setItem(modeKey(projectId), mode)
  } catch {
    // a per-viewer convenience: Start works without it
  }
}

// T14 starter chips
export type StarterId = 'fix' | 'build' | 'audit' | 'issues' | 'file'

/** `fill`: puts a template in the box; `issues`: opens the issue picker; `file`: also opens the file chooser. */
export const STARTERS: readonly { id: StarterId; text?: string }[] = [
  { id: 'fix', text: 'start.starter.fix.text' },
  { id: 'build', text: 'start.starter.build.text' },
  { id: 'audit', text: 'start.starter.audit.text' },
  { id: 'issues' },
  { id: 'file', text: 'start.starter.file.text' }
]

/** A starter fills the box and sets the mode (planning with the person: Run prompts and Plan on its own are a choice). */
export const STARTER_MODE: StartMode = 'chat'

/** The box after a starter: its template when the box is empty or still holds another template, else the template below
 *  what the person wrote. */
export function withStarter(current: string, template: string, templates: readonly string[]): string {
  const c = current.trim()
  return c === '' || templates.some((x) => x.trim() === c) ? template : `${current.trimEnd()}\n\n${template}`
}

/** Ctrl+Enter (Cmd+Enter on a Mac) submits; plain Enter stays a newline. */
export const isSubmitKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean => e.key === 'Enter' && (e.ctrlKey || e.metaKey)

// T17 who the plan is for: the title bar's project, never a picker of Start's own that could disagree with it
export interface ProjectChoice {
  /** All projects (or a selection no project has): the composer asks, and its pick switches the title bar. */
  ask: boolean
  /** The workspace the title bar names (a selected sub-project's root), shown read-only as "for <name>". */
  root?: Project
  /** The workspace and its sub-projects when it has any, the sub-project picker's rows (picked by id: they share the
   *  workspace's folder). Empty otherwise. */
  members: Project[]
  /** The project the Job is filed under. */
  project?: Project
}

/** `scopeId`: the title bar's selection (null = All projects); `picked`: the sub-project picked here, by id. */
export function projectChoice(projects: readonly Project[], scopeId: string | null, picked?: string): ProjectChoice {
  const selected = scopeId === null ? undefined : projects.find((p) => p.id === scopeId)
  // while the list loads, a selected project is not asked for again
  if (!selected) return { ask: scopeId === null || projects.length > 0, members: [] }
  const root = projects.find((p) => p.id === selected.parentId) ?? selected
  const subs = projects.filter((p) => p.parentId === root.id)
  const members = subs.length > 0 ? [root, ...subs] : []
  return { ask: false, root, members, project: members.find((p) => p.id === picked) ?? selected }
}

/** The All-projects picker: workspaces and plain projects; a sub-project is picked once its workspace is. */
export const askOptions = (projects: readonly Project[]): { value: string; label: string }[] =>
  projects.filter((p) => p.parentId === undefined).map((p) => ({ value: p.id, label: p.name }))

// T17 the plan's settings: the project's defaults, then the last choice made here for that project
export type StartWhen = 'now' | 'after' | 'schedule'

export interface StartSettings {
  /** The planner's account; '' is Auto (the Host picks the one with most room). */
  account: string
  /** The workers' reasoning effort; '' is Auto (none sent: each model's default). */
  effort: Effort | ''
  concurrency: number
  /** The saved delivery; what is sent is useDeliveryChoices' effective mode over it. */
  delivery: DeliveryMode
  replan: 'waves' | 'off'
  handsOff: boolean
}

/** A sub-project's unset settings read as its workspace's (projects.ts), then PROJECT_DEFAULTS. */
export function projectDefaults(project: Project | undefined, root: Project | undefined): StartSettings {
  const of = <K extends 'delivery' | 'replan' | 'handsOff' | 'concurrency'>(k: K): Project[K] => project?.[k] ?? root?.[k]
  return {
    account: '',
    effort: '',
    concurrency: Math.min(of('concurrency') ?? PROJECT_DEFAULTS.concurrency, MAX_CONCURRENT_WORKERS),
    delivery: of('delivery') ?? PROJECT_DEFAULTS.delivery,
    replan: of('replan') ?? PROJECT_DEFAULTS.replan,
    handsOff: of('handsOff') ?? PROJECT_DEFAULTS.handsOff
  }
}

export const settingsKey = (projectId: string): string => `astera.start.settings.${projectId}`

/** The fields of a stored choice that still make sense; anything else is dropped. */
function validSettings(raw: unknown): Partial<StartSettings> {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>
  const out: Partial<StartSettings> = {}
  if (typeof r.account === 'string') out.account = r.account
  if (r.effort === '' || isEffort(r.effort)) out.effort = r.effort
  if (typeof r.concurrency === 'number' && Number.isInteger(r.concurrency) && r.concurrency >= 1) out.concurrency = Math.min(r.concurrency, MAX_CONCURRENT_WORKERS)
  if (DELIVERY_MODES.includes(r.delivery as DeliveryMode)) out.delivery = r.delivery as DeliveryMode
  if (r.replan === 'waves' || r.replan === 'off') out.replan = r.replan
  if (typeof r.handsOff === 'boolean') out.handsOff = r.handsOff
  return out
}

function readSettings(projectId: string): Partial<StartSettings> {
  try {
    return validSettings(JSON.parse(window.localStorage.getItem(settingsKey(projectId)) ?? 'null'))
  } catch {
    return {}
  }
}

/** What Start opens with for a project: its defaults, with the choices last made here on top. */
export const startSettings = (projectId: string, defaults: StartSettings): StartSettings => ({ ...defaults, ...readSettings(projectId) })

/** Remembers one choice for the project; the fields never changed here keep following the project's defaults. */
export function rememberSetting(projectId: string, change: Partial<StartSettings>): void {
  try {
    window.localStorage.setItem(settingsKey(projectId), JSON.stringify({ ...readSettings(projectId), ...change }))
  } catch {
    // a per-viewer convenience: Start works without it
  }
}

/** The settings row, one short part per setting: "Auto account · Right away · 10 agents · Merge into main · Hands-off ·
 *  Effort: auto". Hands-off and a plan kept as first written show only when on. */
export function settingsSummary(
  s: { account?: string; when: StartWhen; after?: string; concurrency: number; delivery: string; replan?: 'waves' | 'off'; handsOff: boolean; effort: Effort | '' },
  t: T
): string[] {
  const when = s.when === 'schedule' ? t('start.when.schedule') : s.when === 'after' && s.after ? t('start.opt.after', { plan: s.after }) : t('start.opt.now')
  return [
    s.account ?? t('start.sum.auto'),
    when,
    t('start.sum.agents', { n: s.concurrency }),
    s.delivery,
    ...(s.replan === 'off' ? [t('start.adv.replan.off')] : []),
    ...(s.handsOff ? [t('start.opt.handsOff')] : []),
    t('start.sum.effort', { level: s.effort === '' ? t('start.effort.auto') : s.effort })
  ]
}

/** After Start made the Job: the planner's terminal opens when it started now; a plan queued after another goes to the
 *  agents list (no planner yet). */
export const afterCreate = (sessionId: string | undefined): { openConsole: string } | { openActivity: 'agents' } =>
  sessionId ? { openConsole: sessionId } : { openActivity: 'agents' }

// T2 Start after: only plans that have not finished
/** A `jobs-list` row: the Job with the fields `jobView` derives. */
export type PlanRow = Job & { outcome?: string; questionsOpen?: number; paused?: boolean }

export type LivePlanState = 'queued' | 'planning' | 'waiting' | 'running' | 'held'

/** The plans a new plan may start after, each with its state: queued, planning, waiting for approval, running or held.
 *  Completed, failed, scheduled and archived plans are left out (`jobs-list` already drops archived ones). */
export function livePlans(rows: PlanRow[]): { id: string; name: string; state: LivePlanState }[] {
  const out: { id: string; name: string; state: LivePlanState }[] = []
  for (const r of rows) {
    const state = liveStateOf(r)
    if (state) out.push({ id: r.id, name: jobNameOf(r), state })
  }
  return out
}

function liveStateOf(r: PlanRow): LivePlanState | null {
  if (r.archivedAt !== undefined || r.schedule !== undefined) return null
  if (r.paused === true || r.outcome === 'paused') return 'held'
  if (r.pendingStart === true) return r.after !== undefined ? 'queued' : 'planning'
  if ((r.questionsOpen ?? 0) > 0) return 'waiting'
  return r.outcome === 'running' || r.outcome === 'checking' ? 'running' : null
}

// T5b (decision 6/21): Start's account picker. "Auto (most room)" is the default and sends no account, so the Host
// ranks the accounts by usage; a picked account is only a preference.
export const AUTO_ACCOUNT = 'auto'

/** Auto, then each signed-in Claude account with its weekly and 5h used percent (— while unknown). */
export function accountPickOptions(
  accounts: readonly Account[],
  signedIn: ReadonlySet<string>,
  usage: Readonly<Record<string, AccountUsage>>,
  t: T
): { value: string; label: string }[] {
  const pct = (w: { usedPercent: number } | null | undefined): string => (w ? `${w.usedPercent}%` : '—')
  return [
    { value: AUTO_ACCOUNT, label: t('accounts.auto') },
    ...accounts
      .filter((a) => providerOf(a) === 'claude' && signedIn.has(a.id))
      .map((a) => {
        const u = usage[a.configDir]
        return { value: a.id, label: t('accounts.pickUsage', { name: a.label, weekly: pct(u?.weekly), session: pct(u?.session) }) }
      })
  ]
}

// T14 Start schedule
/** The `jobs-create` args of a Job that runs on a schedule: the intake's own plus the rule (run-create keeps it, as
 *  NewRunModal sent it). Null when the rule is not typed yet or the request is not a `jobs-create` (a GitHub issue pick
 *  has no schedule). Such a Job has no planner: its Tasks are copied into every round. */
export function scheduledArgs(req: { cmd: string; args: Record<string, unknown> } | null, schedule: ScheduleRule | null): Record<string, unknown> | null {
  return req?.cmd === 'jobs-create' && schedule ? { ...req.args, schedule } : null
}

/** T4: a copied OS file attaches by its own path; anything without one (a clipboard image) is saved by `save` first
 *  (files.savePasted) and attaches by the path that answers. In order, one at a time; a file that fails is named in
 *  `failed` and the rest still attach. */
export async function attachableOf(
  files: readonly File[],
  pathFor: (f: File) => string,
  save: (name: string, mime: string, base64: string) => Promise<string>
): Promise<{ attached: { file: File; path: string }[]; failed: string[] }> {
  const attached: { file: File; path: string }[] = []
  const failed: string[] = []
  for (const file of files) {
    try {
      const path = pathFor(file) || (await save(file.name, file.type, base64Of(new Uint8Array(await file.arrayBuffer()))))
      attached.push({ file, path })
    } catch {
      failed.push(file.name)
    }
  }
  return { attached, failed }
}

function base64Of(bytes: Uint8Array): string {
  let bin = ''
  // in chunks: spreading a whole screenshot into fromCharCode overflows the call stack
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
