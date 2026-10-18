// W8-A: `astera blame|stats|why` (also spelled `attribution-blame|stats|why`). Answered in the CLI process before the
// parser, like `heavy`: read-only git in the caller's folder, so they need neither the Host nor the app, and take a
// positional argument the parser does not.
import type { GitRun } from '../git/range'
import { git as realGit } from '../worktrees/git'
import { blameFile } from './blame'
import { readNote } from './note'
import { rangeShas, statsOf } from './stats'

export const ATTRIBUTION_COMMANDS: Readonly<Record<string, 'blame' | 'stats' | 'why'>> = {
  blame: 'blame',
  stats: 'stats',
  why: 'why',
  'attribution-blame': 'blame',
  'attribution-stats': 'stats',
  'attribution-why': 'why'
}

export const ATTRIBUTION_USAGE = {
  blame: ['usage: astera blame <file> [--json]', '', '  Each line of the file: human, ai, mixed or unknown, and the agent/model and Task of an AI line.'],
  stats: [
    'usage: astera stats [<range>] [--json]',
    '',
    '  Lines added by people and by agents over the commits of <range> (default: the last commit), with git-ai’s',
    '  field names: human_additions, mixed_additions, ai_additions, ai_accepted, git_diff_added_lines,',
    '  git_diff_deleted_lines, tool_model_breakdown.'
  ],
  why: [
    'usage: astera why <sha | file:line> [--json]',
    '',
    '  Who made a commit (or the commit of a line): the Job, Task, session and role, the agent, model and account,',
    '  and the command that opens that session.'
  ]
} as const

/** Runs one attribution command (`argv[0]` one of ATTRIBUTION_COMMANDS) in `cwd`; answers the exit code. */
export async function runAttribution(argv: readonly string[], a: { cwd: string; out(text: string): void; run?: GitRun }): Promise<number> {
  const cmd = ATTRIBUTION_COMMANDS[argv[0]]
  const run = a.run ?? realGit
  const rest = argv.slice(1)
  const usage = ATTRIBUTION_USAGE[cmd].join('\n')
  if (rest.includes('--help') || rest.includes('-h')) {
    a.out(usage)
    return 0
  }
  const json = rest.includes('--json')
  const words = rest.filter((w) => !w.startsWith('--'))
  if (words.length > 1 || rest.some((w) => w.startsWith('--') && w !== '--json') || (cmd !== 'stats' && words.length === 0)) {
    a.out(usage)
    return 2
  }
  const fail = (m: string): number => {
    a.out(json ? JSON.stringify({ error: m }) : `astera ${cmd}: ${m}`)
    return 1
  }
  const arg = words[0]

  if (cmd === 'blame') {
    const lines = await blameFile(a.cwd, arg, { run })
    if (lines === null) return fail(`git could not blame ${arg}`)
    if (json) a.out(JSON.stringify(lines.map(({ note, ...l }) => ({ ...l, ...(note ? { agent: note.agent, model: note.model, job: note.job, task: note.task } : {}) }))))
    else
      for (const l of lines) {
        const who = l.note && l.kind !== 'human' ? `${l.note.agent}/${l.note.model} ${l.note.task}` : ''
        a.out(`${String(l.line).padStart(5)} ${l.sha.slice(0, 8)} ${l.kind.padEnd(7)} ${who.padEnd(32)} ${l.content}`)
      }
    return 0
  }

  if (cmd === 'stats') {
    const shas = await rangeShas(a.cwd, arg, run)
    if (shas === null) return fail(`git could not list ${arg ?? 'HEAD'}`)
    const s = await statsOf(a.cwd, shas, run)
    a.out(json ? JSON.stringify(s) : Object.entries(s).map(([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`).join('\n'))
    return 0
  }

  // why
  const at = /^(.+):(\d+)$/.exec(arg)
  let sha: string | null = null
  if (at) {
    const line = await blameFile(a.cwd, at[1], { line: Number(at[2]), run })
    sha = line?.[0]?.sha ?? null
  }
  if (sha === null) {
    const r = await run(['rev-parse', '--verify', '--quiet', `${arg}^{commit}`], { cwd: a.cwd, timeoutMs: 30_000 })
    sha = r.ok ? r.stdout.trim() : null
  }
  if (sha === null) return fail(`not a commit or a file:line: ${arg}`)
  const note = /^0+$/.test(sha) ? null : await readNote(a.cwd, sha, run)
  const open = note !== null && note !== 'unknown' ? `astera sessions read --id ${note.session}` : null
  if (json) {
    a.out(JSON.stringify({ sha, note: note === 'unknown' ? 'unknown' : note, ...(open ? { open } : {}) }))
    return 0
  }
  if (note === null) a.out(`${sha}: no Astera note, so a person made it`)
  else if (note === 'unknown') a.out(`${sha}: its note is not one Astera can read: unknown`)
  else
    a.out(
      [
        `${sha}: ${note.unknown ? 'unknown author' : note.human ? 'made by a person in a worker’s worktree' : `${note.agent}/${note.model}`}${note.lines ? ' (some lines)' : ''}`,
        `  Job:     ${note.job}`,
        `  Task:    ${note.task}`,
        `  Session: ${note.session}`,
        `  Role:    ${note.role}`,
        `  Account: ${note.account}`,
        `  Open the session: ${open}`
      ].join('\n')
    )
  return 0
}
