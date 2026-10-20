// W6-A intake: what the Start page sends, from what the person filled in. Pure, so the node tests cover it; the
// page (pages/StartPage.tsx, through useIntake.ts) only keeps the state and makes the calls.

// T4: the audit and GitHub tabs, the issue picker and "Let Astera pick" are gone — the planner does those by talking.
export type IntakeTab = 'describe' | 'files' | /* W8-C prompts mode */ 'prompts'

/** T4 `--planning`: `chat` talks it through with the person in the planner's terminal; `auto` plans alone. */
export type PlanningMode = 'chat' | 'auto'

export interface IntakeForm {
  tab: IntakeTab
  /** Describe: the objective (may be empty for planning=chat); Files: an optional note beside them. */
  text: string
  /** Describe: the text is a list of problems (`--mode fixlist`). */
  fixlist: boolean
  /** Files: absolute paths. */
  files: string[]
  /** W1-B Job.priority; 0 (the default) is not sent. */
  priority?: number
  /** T4: who plans — the person with the planner (chat), or the planner alone (auto). */
  planning: PlanningMode
  instructions: string
  project: { id: string; path: string } | null
  /** The planner's account when one is known; '' lets the Host pick (T4: Start no longer asks). */
  coordinatorAccount: string
  /** W7-D (#67): how many workers the plan runs at once, 1–10 (the Host clamps to MAX_CONCURRENT_WORKERS). */
  concurrency: number
  /** W8-C prompts mode: Run as written waits for approval (`--approve ask`). */
  approveAsk?: boolean
}

/** The one command that makes the Job, or null while the form cannot make one. */
export function intakeRequest(f: IntakeForm): { cmd: string; args: Record<string, unknown> } | null {
  if (f.project === null) return null
  const text = f.text.trim()
  const common = {
    ...(f.coordinatorAccount !== '' ? { coordinatorAccount: f.coordinatorAccount } : {}),
    concurrency: f.concurrency,
    ...(f.instructions.trim() !== '' ? { instructions: f.instructions.trim() } : {})
  }
  const priority = f.priority ? { priority: f.priority } : {}
  const objective = text !== '' ? { objective: text } : {}
  const planned = { cwd: f.project.path, ...common, ...priority, ...objective, planning: f.planning }
  switch (f.tab) {
    // The text may stay empty for chat: the planner asks what to work on. Planning alone needs something to plan.
    case 'describe':
      return text === '' && f.planning === 'auto' ? null : { cmd: 'jobs-create', args: { ...planned, ...(f.fixlist ? { mode: 'fixlist' } : {}) } }
    case 'files':
      return f.files.length === 0 ? null : { cmd: 'jobs-create', args: { ...planned, attach: f.files } }
    // W8-C prompts mode: the .md files, else the pasted document, each prompt one Task with its text unchanged
    case 'prompts': {
      const approve = f.approveAsk ? { approve: 'ask' } : {}
      if (f.files.length > 0) return { cmd: 'jobs-create', args: { cwd: f.project.path, ...common, ...priority, mode: 'prompts', attach: f.files, ...approve } }
      return text === '' ? null : { cmd: 'jobs-create', args: { cwd: f.project.path, ...common, ...priority, ...objective, mode: 'prompts', ...approve } }
    }
  }
}
