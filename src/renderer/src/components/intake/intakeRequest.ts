// W6-A intake: what the New plan dialog sends, from what the person filled in. Pure, so the node tests cover it; the
// dialog (NewPlanDialog.tsx) only keeps the state and makes the calls.

export type IntakeTab = 'describe' | 'files' | 'audit' | 'github' | /* W8-C prompts mode */ 'prompts'

export interface IntakeForm {
  tab: IntakeTab
  /** Describe: the objective; Files and Audit: an optional note beside them. */
  text: string
  /** Describe: the text is a list of problems (`--mode fixlist`). */
  fixlist: boolean
  /** Files: absolute paths. */
  files: string[]
  /** Audit: a path in the repository, or empty for all of it. */
  scope: string
  /** GitHub: the picked issue numbers. */
  issues: string[]
  assignMe: boolean
  instructions: string
  project: { id: string; path: string } | null
  coordinatorAccount: string
  /** W7-D (#67): how many workers the plan runs at once, 1–10 (the Host clamps to MAX_CONCURRENT_WORKERS). */
  concurrency: number
  /** W8-C prompts mode: Run as written waits for approval (`--approve ask`). */
  approveAsk?: boolean
}

/** The one command that makes the Job, or null while the form cannot make one. */
export function intakeRequest(f: IntakeForm): { cmd: string; args: Record<string, unknown> } | null {
  if (f.project === null || f.coordinatorAccount === '') return null
  const text = f.text.trim()
  const common = {
    coordinatorAccount: f.coordinatorAccount,
    concurrency: f.concurrency,
    ...(f.instructions.trim() !== '' ? { instructions: f.instructions.trim() } : {})
  }
  const job = { cwd: f.project.path, ...common, ...(text !== '' ? { objective: text } : {}) }
  switch (f.tab) {
    case 'describe':
      return text === '' ? null : { cmd: 'jobs-create', args: { ...job, ...(f.fixlist ? { mode: 'fixlist' } : {}) } }
    case 'files':
      return f.files.length === 0 ? null : { cmd: 'jobs-create', args: { ...job, attach: f.files } }
    // W8-C prompts mode: the .md files, else the pasted document, each prompt one Task with its text unchanged
    case 'prompts': {
      const approve = f.approveAsk ? { approve: 'ask' } : {}
      if (f.files.length > 0) return { cmd: 'jobs-create', args: { cwd: f.project.path, ...common, mode: 'prompts', attach: f.files, ...approve } }
      return text === '' ? null : { cmd: 'jobs-create', args: { ...job, mode: 'prompts', ...approve } }
    }
    case 'audit':
      return { cmd: 'jobs-create', args: { ...job, mode: 'audit', scope: f.scope.trim() === '' ? 'all' : f.scope.trim() } }
    case 'github':
      return f.issues.length === 0
        ? null
        : { cmd: 'jobs-create-from-issue', args: { project: f.project.id, issue: f.issues.join(','), ...(f.assignMe ? { assignMe: true } : {}), ...common } }
  }
}

/** #119: which issues the picker lists, by who they are assigned to (`sources-items --assignee`). */
export type AssigneeFilter = 'all' | 'none' | 'me' | 'others'
export const ASSIGNEE_FILTERS: readonly AssigneeFilter[] = ['all', 'none', 'me', 'others']

/** The `sources-items` call behind the GitHub picker: the search text and the assignee filter. */
export function issueSearchArgs(f: { projectId: string; query: string; assignee: AssigneeFilter }): Record<string, unknown> {
  return { source: 'github', project: f.projectId, ...(f.query.trim() ? { query: f.query.trim() } : {}), assignee: f.assignee }
}

/** #119 "Let Astera pick": Astera reads the open issues, skips the held and assigned-elsewhere ones, and makes the plans
 *  itself. `label` and `max` narrow it; `handsOff` is set only when it differs from the project's. */
export function autoPickRequest(
  f: Pick<IntakeForm, 'project' | 'coordinatorAccount' | 'concurrency' | 'instructions' | 'assignMe'> & { label: string; max: string; handsOff?: 'on' | 'off' }
): { cmd: string; args: Record<string, unknown> } | null {
  if (f.project === null || f.coordinatorAccount === '') return null
  const max = Math.trunc(Number(f.max))
  return {
    cmd: 'jobs-create-from-issue',
    args: {
      project: f.project.id,
      auto: true,
      coordinatorAccount: f.coordinatorAccount,
      concurrency: f.concurrency,
      ...(f.label.trim() !== '' ? { label: f.label.trim() } : {}),
      ...(max >= 1 ? { max } : {}),
      ...(f.instructions.trim() !== '' ? { instructions: f.instructions.trim() } : {}),
      ...(f.assignMe ? { assignMe: true } : {}),
      ...(f.handsOff !== undefined ? { handsOff: f.handsOff } : {})
    }
  }
}

/** The ids "Select all" ticks: the rows in view that can be picked. */
const selectableIds = (rows: { id: string; selectable?: boolean }[]): string[] => rows.filter((r) => r.selectable !== false).map((r) => r.id)

/** Select all is ticked when the view has selectable rows and every one is picked. */
export const allSelected = (rows: { id: string; selectable?: boolean }[], picked: string[]): boolean => {
  const ids = selectableIds(rows)
  return ids.length > 0 && ids.every((id) => picked.includes(id))
}

/** Select all: ticks every selectable row in view, or unticks them all when they were all ticked. Picks made under an
 *  earlier search or filter stay. */
export function toggleAll(rows: { id: string; selectable?: boolean }[], picked: string[]): string[] {
  const ids = selectableIds(rows)
  return allSelected(rows, picked) ? picked.filter((id) => !ids.includes(id)) : [...picked, ...ids.filter((id) => !picked.includes(id))]
}
