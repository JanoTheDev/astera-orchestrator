// What every agent Astera starts is told about subagents, in one place. Each role gets one line saying what to fan out
// (its own work, not a generic sentence buried in a long brief) and the same closing rule: the session keeps the
// final check. The session line also goes to hand-opened tabs and to codex through sessionContext.ts, so no text
// here may hold a character LAUNCH_FORBIDDEN (core/sessions/commands.ts) refuses: no quotes, & | < > ^ % or newline.

import type { PromptRole } from '../types'

const TOOL = 'subagents (the Agent tool in Claude Code, parallel sub-tasks in Codex where available)'

export const SUBAGENT_FINAL_CHECK = 'Never hand the final check to a subagent: verify what they return yourself.'

const USE: Record<PromptRole, string> = {
  session: `Use ${TOOL} for work that splits: broad read-only exploration across many files, independent sub-parts, parallel verification.`,
  worker:
    `Use ${TOOL} from the start: send several at once to explore files or folders read-only, and give them independent sub-parts of the Task. ` +
    'Keep the main session for decisions and edits that must agree with each other.',
  reviewer:
    `Use ${TOOL} to read the changed files or areas in parallel, one per area, and to trace their callers and tests. ` +
    'They change no code either; you make the verdict.',
  planner:
    `Use ${TOOL} to explore the codebase before you plan: several at once, one per area the objective touches, read-only. ` +
    'You write every Task yourself.',
  coordinator:
    `Use ${TOOL} to read reports, changed files and plan text in parallel. ` +
    'Never let one edit code, write a Task or send a reply: those stay with you.'
}

/** The subagent guidance of one role, as one line. */
export const subagentGuidance = (role: PromptRole): string => `${USE[role]} ${SUBAGENT_FINAL_CHECK}`
