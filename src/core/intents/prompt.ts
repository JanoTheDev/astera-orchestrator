// W3-B: the one-shot prompt that turns free text into one intent, for the `coordinator` role model (W1-A,
// roleModels.ts) — never the planner's. Its answer is read back through readIntent (types.ts), which drops anything
// that is not an intent, so a wrong or chatty answer is a "could not read that", never a command.
import type { Directory } from './resolve'

/** Plans and sessions listed at most, so the prompt stays a short one-shot call however many plans there are. */
const MAX_PLANS = 40
const MAX_SESSIONS = 12

export interface StatusLine {
  jobId: string
  /** "3/7 done, 2 running, 1 failed". */
  status: string
}

export function parsePrompt(text: string, dir: Directory, status: readonly StatusLine[]): string {
  const statusOf = new Map(status.map((s) => [s.jobId, s.status]))
  const open = dir.plans.find((p) => p.jobId === dir.currentPlanId)
  const here = dir.projects.find((p) => p.path === dir.currentProjectPath)
  const plans = dir.plans.slice(0, MAX_PLANS).map((p) => {
    const sessions = p.sessions
      .slice(0, MAX_SESSIONS)
      .map((s) => `${s.label}${s.taskTitle ? ` (${s.taskTitle})` : ''}`)
      .join('; ')
    return `- ${p.projectName} › ${p.name}${p.pendingStart ? ' [not started]' : ''}${statusOf.has(p.jobId) ? ` — ${statusOf.get(p.jobId)}` : ''}${sessions ? `\n  sessions: ${sessions}` : ''}`
  })
  return [
    'You turn one command for a coding-agent orchestrator into JSON. Do not read files or use tools.',
    'Answer with exactly one JSON object and nothing else. Its "kind" is one of:',
    '- {"kind":"switch","target":T} open a plan\'s workspace',
    '- {"kind":"show-sessions","target":T} list a plan\'s sessions',
    '- {"kind":"plan","objective":"...","target":PROJECT?} create a new plan and start its planner',
    '- {"kind":"approve","target":T} approve and start a plan',
    '- {"kind":"pause","target":T} / {"kind":"resume","target":T} / {"kind":"stop-launching","target":T} hold or let go; T may be a plan or one worker ("worker three")',
    '- {"kind":"stop","target":T} stop a plan and close its sessions',
    '- {"kind":"send","session":S,"text":"...","target":T?} type text into one session',
    '- {"kind":"summarize","minutes":N?,"target":T?} progress, optionally of the last N minutes',
    '- {"kind":"waiting","target":T?} sessions waiting for the person',
    '- {"kind":"archive","target":T} / {"kind":"delete","target":T} / {"kind":"merge","target":T}',
    '- {"kind":"plan-feedback","text":"...","target":T?} ask the planner to change a plan ("change the plan: ...", "tell the planner ...")',
    '- {"kind":"plan-reject","reason":"..."?,"target":T?} reject a plan waiting for approval',
    '- {"kind":"reply","text":"..."} anything else: answer briefly from the status below, or ask what they mean',
    'T is a plan or project name exactly as the person said it; leave "target" out for "this plan" or none.',
    'S is a session name as said ("worker three", "the API worker"). Never invent names that are not in the text.',
    '',
    `Open project: ${here?.name ?? 'none'}. Open plan: ${open ? `${open.projectName} › ${open.name}` : 'none'}.`,
    'Plans:',
    ...(plans.length > 0 ? plans : ['(none)']),
    '',
    `Command: ${JSON.stringify(text)}`
  ].join('\n')
}
