// Workers never deliver (owner spec 2026-10-18, part 3). A worker's `git push` or `gh pr create` is refused by a
// PreToolUse hook on Bash, in every Claude session Astera spawns (statusline.ts ensureFiles). The brief says it
// already; this enforces it. Delivery is the app's (deliverByPush, openCompletedRunPrs), once the whole plan is done.
//
// **Only a worker is refused.** The script asks orchestration.json beside it (the profile dir, where the app and the
// Host both keep it) whether this session (`ASTERA_SESSION`) holds an open Dispatch: that is the server's own rule for
// a worker (`isWorker`, ADR-004). A coordinator, a planner and the owner's own tabs push as before.
//
// **The hook runs only for a matching command**: the handlers carry Claude Code's `if` filter (permission rule
// syntax, 2.1.301: "Avoids spawning hooks for non-matching commands"), so an ordinary Bash call spawns no node.
//
// shortcut: a Codex worker gets no Claude hooks, so it is not refused here; add a Codex-side guard if one delivers.
// shortcut: unreadable state lets the call through, as the subagent cap does: a broken guard must not stop a tab.

/** The `if` filters of the hook's handlers: one per refused command, anywhere in a compound line. */
export const DELIVERY_GUARD_IFS = ['Bash(*git *push*)', 'Bash(*gh pr create*)'] as const

/** Why a worker's Bash command is refused, or null. Self-contained on purpose: its source runs inside the script. */
export function deliveryRefusal(command: unknown, isWorker: boolean): string | null {
  if (!isWorker || typeof command !== 'string') return null
  // `git push`, also `git -C dir push`; one shell segment, so `git log; echo push` is not it
  const push = /(^|[^\w-])git(\s+-{1,2}[^\s;&|]+(\s+[^-\s;&|][^\s;&|]*)?)*\s+push\b/.test(command)
  const pr = /(^|[^\w-])gh\s+pr\s+create\b/.test(command)
  if (!push && !pr) return null
  return (
    'Astera: workers never deliver. Commit your work on your own branch and report done ' +
    '(`astera send --type worker_done`); Astera merges and delivers the plan when it is complete. ' +
    `Refused: ${push ? 'git push' : 'gh pr create'}.`
  )
}

/** Whether `sessionId` holds an open Dispatch in an orchestration state. Self-contained: it runs inside the script. */
export function holdsOpenDispatch(state: unknown, sessionId: unknown): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const ds = (state as { dispatches?: unknown } | null)?.dispatches
  if (!Array.isArray(ds)) return false
  return ds.some(
    (d: { sessionId?: unknown; outcome?: unknown; endedAt?: unknown } | null) =>
      !!d && d.sessionId === sessionId && !d.outcome && !d.endedAt
  )
}

/** The hook command (node): reads the PreToolUse payload on stdin and prints the deny JSON for a worker's refused
 *  command. Any failure lets the call through. */
export const DELIVERY_GUARD_SCRIPT = `const fs = require('fs')
const path = require('path')
const refusal = ${deliveryRefusal.toString()}
const holds = ${holdsOpenDispatch.toString()}
const chunks = []
function finish() {
  let deny = null
  try {
    const p = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const command = p && p.tool_input && p.tool_input.command
    if (refusal(command, true)) {
      let state = null
      try { state = JSON.parse(fs.readFileSync(path.join(__dirname, 'orchestration.json'), 'utf8')) } catch {}
      deny = refusal(command, holds(state, process.env.ASTERA_SESSION))
    }
  } catch {}
  if (deny) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: deny } }))
  process.exit(0)
}
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', finish)
process.stdin.on('error', finish)
`
