// T12: work this machine cannot prove. A worker that cannot run something its Task needs proven (a Linux-only `.sh`
// build, `flock`, an `apt` dependency on this Windows machine) reports succeeded with `--not-provable "<what and why>"`.
// In a hands-off plan such a Task is accepted with that note instead of burning its attempts: a failed report that only
// says a tool or OS is missing here, over committed work, is taken the same way (command.ts worker_done), and so is a
// review whose only blockers need an environment this machine does not have (autoAnswer.ts handsOffStepsDue).
// Pure: no clock, no files.
import type { ReviewIssue, Task } from '../types'

/** The longest note kept from a report line. */
const NOTE_MAX = 300

/** The words that say "this machine lacks a tool or an OS", each conservative: the shell's or the OS's own wording for
 *  a program that is not there, or a plain statement that the work needs another OS. A missing file, module or test is
 *  not one: that is the work's own failure. */
const MISSING_TOOL: RegExp[] = [
  // posix shells: "bash: flock: command not found", "zsh: command not found: flock"
  /\bcommand not found\b/i,
  // dash / sh: "sh: 1: flock: not found", "/bin/sh: 2: ./build.sh: not found"
  /\b(?:sh|bash|dash|ash|zsh)(?::\s*(?:line\s+)?\d+)?:\s*[\w./+-]+:\s*not found\b/i,
  // a bare "flock: not found" line, as busybox and `env` print it
  /^\s*(?!(?:error|warning|fatal|file|module|package|path|test|page|key|item|resource|entry|branch|ref|user|host)\b)[a-z][\w+-]*:\s*not found\s*$/im,
  // cmd.exe: "'flock' is not recognized as an internal or external command"
  /\bis not recognized as an internal or external command\b/i,
  // PowerShell: "The term 'flock' is not recognized as the name of a cmdlet, function, script file, or operable program"
  /\bis not recognized as (?:the|a) name of a cmdlet\b/i,
  // node: "spawn flock ENOENT", "spawnSync bash ENOENT"
  /\bspawn(?:Sync)?\s+\S+\s+ENOENT\b/,
  // "Linux-only", "macOS only"
  /\b(?:linux|macos|mac os|darwin|unix|posix)[- ]only\b/i,
  // "requires Linux", "needs macOS"
  /\b(?:requires?|needs?)\s+(?:a\s+)?(?:linux|macos|mac os x?|darwin|wsl|unix)\b/i,
  // "only runs on Linux"
  /\bonly\s+(?:runs?|works?|builds?|available|supported)\s+on\s+(?:linux|macos|mac os|darwin|unix|posix)\b/i,
  // "not supported on Windows"
  /\bnot\s+(?:supported|available|runnable)\s+on\s+(?:windows|win32|this (?:os|platform|machine))\b/i
]

/**
 * The line of a failed report that clearly says this machine lacks a tool or an OS (Windows and posix wordings), as the
 * note to keep: what could not run and why. null when no line says so. The caller decides whether the rest holds
 * (a hands-off plan, committed work): this only reads the words.
 */
export function missingToolOf(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || !MISSING_TOOL.some((re) => re.test(line))) continue
    return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 3)}...` : line
  }
  return null
}

/** The decision's choice for a Task accepted with what this machine cannot run: "accepted T: not provable here: …". */
export const acceptedNotProvable = (title: string, note: string): string => `accepted ${title}: not provable here: ${note}`

/** The blocking review issues of a Task when every one of them needs an environment this machine lacks
 *  (`needs: 'environment'`), and there is at least one; null otherwise. A blocker a code change fixes, or one that needs
 *  a scope, permission or person call, keeps today's path. */
export function environmentOnlyIssues(task: Pick<Task, 'reviewIssues'> | undefined): ReviewIssue[] | null {
  const blocking = (task?.reviewIssues ?? []).filter((i) => i.blocking)
  return blocking.length > 0 && blocking.every((i) => i.needs === 'environment') ? blocking : null
}

/** How an answer that accepted environment-only review issues starts; the next review reads it as the owner's answer. */
export const NOT_PROVABLE_ANSWER_HEAD = 'Accepted as not provable here:'

/** The answer to an environment-only `review-needs-decision` Gate in a hands-off plan. It is put verbatim into the
 *  repair worker's prompt, and the next reviewer reads it among the owner's answers (reviewer.ts ownerAnswersOf). */
export const notProvableReviewAnswer = (issues: readonly Pick<ReviewIssue, 'title'>[]): string =>
  `${NOT_PROVABLE_ANSWER_HEAD} ${issues.map((i) => i.title).join('; ')}. This machine cannot provide that environment, ` +
  'so that proof is dropped from this Task and its absence is not a finding. Change no code for it: report succeeded ' +
  'with --not-provable "<what could not run>: <why it cannot run here>".'

/** Whether a Gate answer is such an acceptance: a Task accepted once is not accepted again in a loop. */
export const isNotProvableAnswer = (resolution: string | undefined): boolean =>
  resolution !== undefined && resolution.startsWith(NOT_PROVABLE_ANSWER_HEAD)
