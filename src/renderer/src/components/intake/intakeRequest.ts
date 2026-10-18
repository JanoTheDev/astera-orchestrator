// W6-A intake: what the New plan dialog sends, from what the person filled in. Pure, so the node tests cover it; the
// dialog (NewPlanDialog.tsx) only keeps the state and makes the calls.

export type IntakeTab = 'describe' | 'files' | 'audit' | 'github'

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
}

/** The one command that makes the Job, or null while the form cannot make one. */
export function intakeRequest(f: IntakeForm): { cmd: string; args: Record<string, unknown> } | null {
  if (f.project === null || f.coordinatorAccount === '') return null
  const text = f.text.trim()
  const common = {
    coordinatorAccount: f.coordinatorAccount,
    ...(f.instructions.trim() !== '' ? { instructions: f.instructions.trim() } : {})
  }
  const job = { cwd: f.project.path, ...common, ...(text !== '' ? { objective: text } : {}) }
  switch (f.tab) {
    case 'describe':
      return text === '' ? null : { cmd: 'jobs-create', args: { ...job, ...(f.fixlist ? { mode: 'fixlist' } : {}) } }
    case 'files':
      return f.files.length === 0 ? null : { cmd: 'jobs-create', args: { ...job, attach: f.files } }
    case 'audit':
      return { cmd: 'jobs-create', args: { ...job, mode: 'audit', scope: f.scope.trim() === '' ? 'all' : f.scope.trim() } }
    case 'github':
      return f.issues.length === 0
        ? null
        : { cmd: 'jobs-create-from-issue', args: { project: f.project.id, issue: f.issues.join(','), ...(f.assignMe ? { assignMe: true } : {}), ...common } }
  }
}
