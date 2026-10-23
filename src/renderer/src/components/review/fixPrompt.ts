// The text a hunk action sends: the prompt "Ask AI to fix" types into an agent session, and the change request
// "Request changes" sends to a plan. English on purpose: it is read by an agent, not shown in the UI.

/** The part of the code an action is about: a whole hunk, or the lines the owner selected in it. */
export interface CodeRef {
  /** Repository-relative path. */
  path: string
  /** New-file line range (1-based, inclusive). */
  start: number
  end: number
  /** The diff lines (`+`, `-`, ` ` prefixes kept), with or without the `@@` line. */
  diff: string
  /** The changed symbol it sits in, when the map knows it. */
  symbol?: string
}

/** Past this the quoted diff is cut: a prompt is typed into a session, and a huge paste helps no one. */
export const MAX_QUOTED_CHARS = 6000

const fence = (diff: string): string => {
  const body = diff.replace(/\n+$/, '')
  const cut = body.length > MAX_QUOTED_CHARS ? `${body.slice(0, MAX_QUOTED_CHARS)}\n… (cut: ${body.length - MAX_QUOTED_CHARS} more characters)` : body
  // a fence longer than any run of backticks inside, so the quote cannot end early
  const ticks = '`'.repeat(Math.max(3, ...[...cut.matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `${ticks}diff\n${cut}\n${ticks}`
}

export const rangeText = (r: Pick<CodeRef, 'start' | 'end'>): string => (r.start === r.end ? `line ${r.start}` : `lines ${r.start}-${r.end}`)

const where = (r: CodeRef): string => `${r.path}, ${rangeText(r)}${r.symbol ? ` (in \`${r.symbol}\`)` : ''}`

/** The prompt for an agent working in the worktree. The note leads: it is what the owner wants; the code follows. */
export function fixPrompt(ref: CodeRef, note: string): string {
  const ask = note.trim() || 'Review this change and fix what is wrong with it.'
  return [
    `Please fix this part of the change in ${where(ref)}.`,
    '',
    `What I want: ${ask}`,
    '',
    'The diff of that part against the base:',
    fence(ref.diff),
    '',
    'Change only what this needs, keep the rest of the file as it is, and commit when done.'
  ].join('\n')
}

/** The change request for a plan Task (sent through `jobs-feedback`): names the Task so the replan finds it, then the
 *  note and the quoted code. */
export function changeRequestText(task: { id: string; title: string }, ref: CodeRef, note: string): string {
  const ask = note.trim() || 'This part needs another look.'
  return [
    `Request changes on Task "${task.title}" (${task.id}): ${where(ref)}.`,
    '',
    ask,
    '',
    fence(ref.diff)
  ].join('\n')
}
