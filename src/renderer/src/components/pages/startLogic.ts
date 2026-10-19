// W9-E Start page rules (DESIGN §2 "Start"). Pure, so the node tests cover them; StartPage.tsx keeps the state.
import type { IntakeTab } from '../intake/intakeRequest'

/** The three mode cards: the planner writes the plan, audits paths of the repository first (T2, `--mode audit`), or
 *  each prompt runs as written (W8-C `--mode prompts`). */
export type StartMode = 'plan' | 'audit' | 'prompts'

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

/** Prompt files attached ⇒ Run as written; typed text or rough notes ⇒ Plan it for me. The owner's pick wins. */
export function defaultMode({ files, chosen }: { files: string[]; text?: string; chosen?: StartMode }): StartMode {
  if (chosen) return chosen
  // A PDF or a screenshot is material for the planner, not a prompt to run as written
  return files.some((f) => PROMPT_FILE.test(f)) ? 'prompts' : 'plan'
}

/** The one W6-A intake tab Start's composer amounts to. */
export function intakeTab({ mode, files, issues }: { mode: StartMode; files: string[]; issues: string[] }): IntakeTab {
  if (mode === 'prompts' || mode === 'audit') return mode
  if (issues.length > 0) return 'github'
  return files.length > 0 ? 'files' : 'describe'
}

/** How many Tasks Run as written makes: one per prompt file, else one per `##` section of the pasted document. */
export function promptCount(files: string[], text: string): number {
  const md = files.filter((f) => PROMPT_FILE.test(f)).length
  if (files.length > 0) return md
  return text.split('\n').filter((l) => /^##\s/.test(l)).length || (text.trim() ? 1 : 0)
}

type T = (key: string, params?: Record<string, string | number>) => string

/** The primary button says what will happen: "Start planning", "Audit 2 paths", or "Start 3 consoles" with
 *  "3 files → 3 tasks". */
export function primaryLabel(
  { mode, files, text, after, named, scope = [] }: { mode: StartMode; files: string[]; text: string; after?: string; named?: number; scope?: string[] },
  t: T
): { label: string; note?: string } {
  if (after) return { label: t('start.go.queue', { plan: after }) }
  if (mode === 'plan') return { label: t('start.go.plan') }
  if (mode === 'audit') return { label: scope.length === 0 ? t('start.go.audit') : t('start.go.auditPaths', { n: scope.length }) }
  // W10-A: prompt names typed with nothing attached count the files they resolved to
  if (named !== undefined && files.length === 0) return { label: t('start.go.consoles', { n: named }), note: t('start.go.namesNote', { n: named }) }
  const n = promptCount(files, text)
  return {
    label: t('start.go.consoles', { n }),
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

// T2 sticky hands-off and More options
/** Switching Hands-off on Start saves it as the project's default (`projects-set --hands-off`), so it sticks. */
export const handsOffSaveArgs = (projectId: string, on: boolean): Record<string, unknown> => ({ id: projectId, handsOff: on ? 'on' : 'off' })

/** The closed More options line: "3 consoles · PR · ask · Work" (the account part only once one is picked). */
export function optionsSummary(
  { concurrency, delivery, approval, account, priority }: { concurrency: number; delivery: 'pr' | 'push'; approval: 'ask' | 'auto'; account?: string; priority: number },
  t: T
): string {
  return [
    t('start.more.consoles', { n: concurrency }),
    t(delivery === 'pr' ? 'start.more.pr' : 'start.more.push'),
    t(approval === 'ask' ? 'start.more.ask' : 'start.more.auto'),
    ...(account ? [account] : []),
    ...(priority !== 0 ? [t('start.more.priority', { n: priority })] : [])
  ].join(' · ')
}

/** The audit scope picker's chips: a typed path added once, trimmed, without a leading ./ or a trailing slash. */
export function addScopePath(scope: string[], typed: string): string[] {
  const p = typed.trim().replace(/^\.\//, '').replace(/[\\/]+$/, '')
  return p === '' || scope.includes(p) ? scope : [...scope, p]
}
