// Windows caps a command line at ~32k characters. A plan grows (27+ Tasks, dozens of worktrees), so no git or gh call may
// let its argv grow with it: long input goes on stdin or in a temp file. This is the budget the tests hold every spawned
// command line to, and the line git()/gh() warn about when a call passes it.
export const ARGV_BUDGET = 8000

/** The length of the command line `cmd args…` as CreateProcess sees it: each argument plus its separator and the
 *  quotes Windows may add around it. */
export function argvLength(cmd: string, args: readonly string[]): number {
  return [cmd, ...args].reduce((n, a) => n + a.length + 3, 0)
}

/** Warns, without throwing, when a call's command line passed the budget: the call still runs (it may be fine), but the
 *  place that built it has to move its long input off the command line. */
export function warnLongArgv(cmd: string, args: readonly string[]): void {
  const n = argvLength(cmd, args)
  if (n > ARGV_BUDGET) console.warn(`[argv] ${cmd} ${args.slice(0, 3).join(' ')} … runs with a ${n}-character command line (budget ${ARGV_BUDGET}); pass the long input on stdin or in a file`)
}

/** Spawn errors that mean the command line itself was too long. */
export const ARGV_TOO_LONG_CODES: ReadonlySet<string> = new Set(['ENAMETOOLONG', 'E2BIG'])
