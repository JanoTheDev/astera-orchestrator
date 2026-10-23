// English · misc area. Which files each area serves: ../README.md.
import type { misc as ko } from '../ko/misc'

export const misc: Record<keyof typeof ko, string> = {
  'wall.plans.search': 'Find a plan',
  'wall.scope.label': 'Scope',
  'wall.scope.plan': 'This plan',
  'wall.scope.noProject': 'No project',
  'wall.finished.title': 'Finished · what each console did',
  'worktrees.fact.ahead': 'Ahead of base',
  'worktrees.fact.behind': 'Behind base',
  'session.usage.fiveHourLabel': '5h usage',
  // W2-A planner stage
  'jobs.new.planner': 'Plan with planner first',
  // W6-D
  'jobs.new.replan': 'Replan between waves',
  'jobs.new.replanHint': 'Before each next wave, and once at the end, a fresh planner adjusts the Tasks that have not started to what really happened. New workers wait while it does.',
  // W1-B: global scheduling
  'jobs.new.priority': 'Priority',
  'jobs.new.priorityHint': 'When the app-wide worker limit is reached, higher goes first (default 0)',
  'jobs.new.schedule': 'Scheduled run',
  // W6-A intake (components/intake/, pages/StartPage.tsx)
  'intake.open': 'New plan from files, an audit or GitHub issues…',
  'intake.title': 'New plan',
  'intake.project': 'Project',
  'intake.tab.describe': 'Describe',
  'intake.tab.files': 'Files',
  'intake.tab.audit': 'Audit',
  'intake.tab.github': 'GitHub',
  // W8-C prompts mode
  'intake.tab.prompts': 'Run as written',
  'intake.promptsHint': 'Drop .md prompt files (one Task each) or paste one document (one Task per ## section). Your text is never rewritten; the order comes from docs/dev/PLAN.md.',
  'intake.promptsPaste': 'Or paste one document with ## sections',
  'intake.promptsAsk': 'Ask me to approve the plan first',
  'intake.describe': 'What should be built or fixed?',
  'intake.fixlist': 'This is a list of problems: one or more Tasks per problem',
  'intake.drop': 'Drop PDFs or other files here (at most 30 MB each)',
  'intake.note': 'A note on the files (optional)',
  'intake.scope': 'What to audit: a path in the repository, or all',
  'intake.auditHint': 'The planner audits it for bugs, security holes and missing tests, writes inputs/audit.md, then plans the fixes.',
  'intake.search': 'Search open issues',
  'intake.assignMe': 'Assign me to the picked issues',
  'intake.instructions': 'Extra instructions (they win over the source)',
  'intake.create': 'Create and plan',
  // W7-D (#67)
  'intake.concurrency': 'Workers at once (1–100)',
  'conversation.model.effortMore': 'More, on the CLI screen',
  'conversation.model.effort': 'Change effort (in the terminal)',
  'conversation.model.change': 'Change model and effort (in the terminal)',
  'remote.sessions.signedOut': 'Signed out',
  'intake.after': 'Start after',
  'intake.afterNone': 'None: plan now',
  'pages.tasks.empty': 'No Tasks here yet.',
  'pages.tasks.planning.badge': 'planning',
  'pages.plans.folder': 'Folder',
  'pages.plan.startAfterNow': 'Start right away',
  'new.console': 'Console',
  'new.plan': 'Plan it for me',
  'new.prompts': 'Run as written',
  'start.title': 'What should we build in {project}?',
  'start.titleNoProject': 'Choose a project to start a plan',
  // T2 Start: Audit mode, sticky hands-off, More options
  // T4 Start opens the planner chat
  'start.options': 'Options',
}
