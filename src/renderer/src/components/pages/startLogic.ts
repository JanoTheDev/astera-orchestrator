// W9-E Start page rules (DESIGN §2 "Start"). Pure, so the node tests cover them; StartPage.tsx keeps the state.
import type { IntakeTab } from '../intake/intakeRequest'
import type { ScheduleRule } from '../../../../core/types'
import type { Job } from '../../../../core/orchestration/types'
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

// T2 sticky hands-off
/** Switching Hands-off on Start saves it as the project's default (`projects-set --hands-off`), so it sticks. */
export const handsOffSaveArgs = (projectId: string, on: boolean): Record<string, unknown> => ({ id: projectId, handsOff: on ? 'on' : 'off' })

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

/** The project picker lists projects only: never "All projects". A placeholder shows while none is chosen. */
export function projectOptions(projects: readonly { name: string; path: string }[], chosen: string, placeholder: string): { value: string; label: string }[] {
  const list = projects.map((p) => ({ value: p.path, label: p.name }))
  return chosen === '' ? [{ value: '', label: placeholder }, ...list] : list
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
