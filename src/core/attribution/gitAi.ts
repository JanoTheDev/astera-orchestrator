// W8-B: git-ai (github.com/git-ai-project/git-ai) as a reader only. The spike (docs/dev/LINUX.md, "git-ai
// spike") chose the native engine, so Astera never installs git-ai and never needs it. When the owner has it on PATH
// anyway, a commit it noted (`refs/notes/ai`, its authorship log) is read into the Wave 8 `lines` shape, so lines git-ai
// saw in an editor of its own are not lost. Absent tool or absent note: null, and the native answer stands.
//
// The log (schema `authorship/3.0.0`, read off v1.7.5's notes): per file, the file path, then one indented line per
// attestation `<session>::<trace> <ranges>` (ranges `1-5`, `7`, `2-3,9`); then a `---` line; then JSON whose `sessions`
// maps each AI session id to `{ agent_id: { tool, id, model } }`. An attestation whose session is not in that map is
// not AI.
import { execFile } from 'node:child_process'
import { git } from '../worktrees/git'
import type { GitRun } from '../git/range'
import { rangesOf, type NoteLines } from './lines'

export const GIT_AI_NOTES_REF = 'refs/notes/ai'
/** What Settings shows to copy when git-ai is not installed. The owner runs it; Astera does not (PLAN.md, Wave 8). */
export const GIT_AI_INSTALL_COMMAND = 'curl -sSL https://usegitai.com/install.sh | bash'

export interface GitAiNote {
  /** AI lines of every session, per path. */
  lines: NoteLines
  /** `<tool>::<model>` → AI lines, the key git-ai's `tool_model_breakdown` uses. */
  toolModel: { [key: string]: number }
}

/** One git-ai authorship log, or null when it is not one. */
export function parseGitAiNote(text: string): GitAiNote | null {
  const cut = text.split('\n').findIndex((l) => l.trim() === '---')
  if (cut < 0) return null
  let meta: { sessions?: Record<string, { agent_id?: { tool?: unknown; model?: unknown } }> }
  try {
    meta = JSON.parse(text.split('\n').slice(cut + 1).join('\n'))
  } catch {
    return null
  }
  const sessions = meta.sessions ?? {}
  const perPath = new Map<string, number[]>()
  const toolModel: { [key: string]: number } = {}
  let file: string | null = null
  for (const raw of text.split('\n').slice(0, cut)) {
    if (raw.trim() === '') continue
    if (!/^\s/.test(raw)) {
      file = raw.trim()
      continue
    }
    const m = /^\s+(\S+?)(?:::\S+)?\s+([\d,\s-]+)$/.exec(raw)
    const agent = m ? sessions[m[1]]?.agent_id : undefined
    if (!m || file === null || !agent) continue
    const nums: number[] = []
    for (const part of m[2].split(/[,\s]+/).filter(Boolean)) {
      const [a, b] = part.split('-').map(Number)
      for (let n = a; n <= (b ?? a); n++) nums.push(n)
    }
    perPath.set(file, [...(perPath.get(file) ?? []), ...nums])
    const key = `${typeof agent.tool === 'string' ? agent.tool : 'unknown'}::${typeof agent.model === 'string' ? agent.model : 'unknown'}`
    toolModel[key] = (toolModel[key] ?? 0) + nums.length
  }
  const lines: NoteLines = {}
  for (const [p, ns] of perPath) lines[p] = rangesOf(ns)
  return { lines, toolModel }
}

/** Whether `git-ai` is on PATH. Never throws. */
export function gitAiInstalled(exec: typeof execFile = execFile): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      exec('git-ai', ['--version'], { timeout: 5_000 }, (err) => resolve(!err))
    } catch {
      resolve(false)
    }
  })
}

/** git-ai's lines for commit `sha`: null when git-ai is not installed or did not note that commit. Never throws. */
export async function gitAiLinesOf(
  repo: string,
  sha: string,
  deps: { installed?: () => Promise<boolean>; run?: GitRun } = {}
): Promise<GitAiNote | null> {
  if (!(await (deps.installed ?? gitAiInstalled)())) return null
  const run: GitRun = deps.run ?? ((args, o) => git(args, o))
  const r = await run(['notes', `--ref=${GIT_AI_NOTES_REF}`, 'show', sha], { cwd: repo, timeoutMs: 10_000 })
  return r.ok ? parseGitAiNote(r.stdout) : null
}
