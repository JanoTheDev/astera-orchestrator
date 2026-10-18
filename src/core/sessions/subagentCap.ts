// W6-G: at most `maxSubagentsPerSession` subagents at once in one Claude tab.
//
// Every Claude session Astera spawns gets three hooks that run SUBAGENT_CAP_SCRIPT (statusline.ts ensureFiles):
// a synchronous PreToolUse on `Agent|Task`, SubagentStop, and SessionStart on startup or resume. The script keeps
// one number per session beside its hook events (`hook-events/<sid>.subagents`): +1 when a subagent call is let
// through, −1 when a subagent stops, never below 0, and 0 again when the session starts, so a crashed tab's stale
// count does not hold its next life back. At the cap the call is denied with PreToolUse's documented JSON
// (`hookSpecificOutput.permissionDecision: "deny"`, checked against Claude Code 2.1.301's hook output schema), and
// Claude reads the reason back as the tool's answer.
//
// **The counting rule is `subagentStep`, and the script runs that very function**: its source is spliced into the
// script text, so the test of the rule is a test of what the hook does.
//
// The cap is read from app-settings.json beside the script at each call, so a change in Settings reaches running
// tabs at their next subagent, which a value baked into the per-session `--settings` file would not.
//
// shortcut: a subagent call let through and then refused by a permission prompt or a failed launch (or a subagent
// that ends without SubagentStop, if Claude Code ever does that) keeps its +1 until SessionStart; if that shows up in
// practice, also count down on PostToolUseFailure for `Agent|Task`.
// shortcut: the lock is a mkdir with a 5 s stale break and a 2 s give-up that runs unlocked; two hooks breaking one
// stale lock at once can lose a count. Locks are held for milliseconds, so a stale one means a crashed hook.
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SUBAGENT_CAP_DEFAULT = 10
export const SUBAGENT_CAP_MAX = 10

/** The app setting `maxSubagentsPerSession` as every reader narrows it: a whole number from 1 to 10, else 10.
 *  Self-contained on purpose (no module constants): its source runs inside SUBAGENT_CAP_SCRIPT. */
export function maxSubagentsPerSessionOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10 ? value : 10
}

/**
 * One hook event applied to a tab's subagent count. `deny` is the reason to refuse the call with, or null.
 * - `SessionStart`: 0 (a restarted tab has none of its old subagents running).
 * - `SubagentStop`: one fewer, never below 0 (a stop for a subagent counted before a reset is ignored).
 * - `PreToolUse` for `Agent`/`Task`: one more, or a refusal at the cap, the count unchanged.
 * - anything else: unchanged.
 * Self-contained on purpose (no module constants): its source runs inside SUBAGENT_CAP_SCRIPT.
 */
export function subagentStep(
  count: number,
  event: unknown,
  toolName: unknown,
  cap: number
): { count: number; deny: string | null } {
  const n = Number.isInteger(count) && count > 0 ? count : 0
  if (event === 'SessionStart') return { count: 0, deny: null }
  if (event === 'SubagentStop') return { count: Math.max(0, n - 1), deny: null }
  if (event === 'PreToolUse' && (toolName === 'Agent' || toolName === 'Task')) {
    if (n >= cap)
      return { count: n, deny: `Astera: ${n} subagents already running in this tab (limit ${cap}). Wait for one to finish.` }
    return { count: n + 1, deny: null }
  }
  return { count: n, deny: null }
}

/** Where a session's count lives, from its hook events file (`<sid>.jsonl` → `<sid>.subagents`). Not `.jsonl`, so
 *  the hook event watcher and the app's startup cleanup pass it by. Self-contained: it runs inside the script. */
export function subagentCountFileOf(hookOut: string): string {
  return hookOut.replace(/\.jsonl$/, '') + '.subagents'
}

/** A session's live subagent count as its hook keeps it, 0 when it has none yet. */
export async function readSubagentCount(hookEventsDir: string, sessionId: string): Promise<number> {
  try {
    const n = Number((await fs.readFile(path.join(hookEventsDir, `${sessionId}.subagents`), 'utf8')).trim())
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * The hook command (node). Reads the hook payload on stdin and the cap from app-settings.json beside it, updates
 * the count under a lock (Claude Code may run the hooks of parallel subagent calls at once), and prints the deny
 * JSON when the call is over the cap. With ASTERA_HOOK_OUT unset it does nothing. Any failure lets the call through:
 * a broken counter must never stop a tab from working.
 */
export const SUBAGENT_CAP_SCRIPT = `const fs = require('fs')
const path = require('path')
const step = ${subagentStep.toString()}
const capOf = ${maxSubagentsPerSessionOf.toString()}
const countFileOf = ${subagentCountFileOf.toString()}
const out = process.env.ASTERA_HOOK_OUT
function cap() {
  try { return capOf(JSON.parse(fs.readFileSync(path.join(__dirname, 'app-settings.json'), 'utf8')).maxSubagentsPerSession) } catch { return capOf(undefined) }
}
function locked(file, fn) {
  const lock = file + '.lock'
  const until = Date.now() + 2000
  for (;;) {
    try { fs.mkdirSync(lock); break } catch (e) {
      if (!e || e.code !== 'EEXIST' || Date.now() > until) return fn()
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmdirSync(lock) } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  try { return fn() } finally { try { fs.rmdirSync(lock) } catch {} }
}
const chunks = []
function finish() {
  let deny = null
  try {
    const p = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (out && p && typeof p === 'object') {
      const file = countFileOf(out)
      locked(file, () => {
        let count = 0
        try { count = Number(fs.readFileSync(file, 'utf8').trim()) || 0 } catch {}
        const r = step(count, p.hook_event_name, p.tool_name, cap())
        deny = r.deny
        if (r.count !== count) { try { fs.writeFileSync(file, String(r.count)) } catch {} }
      })
    }
  } catch {}
  if (deny) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: deny } }))
  process.exit(0)
}
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', finish)
process.stdin.on('error', finish)
`
