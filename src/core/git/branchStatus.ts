import type { ProjectGitStatus } from '../types'

/**
 * Parses `git status --porcelain=v2 --branch` (newline separated) into the project switcher's line: the branch, how many
 * paths are changed or untracked, and how far it is ahead of (unpushed) and behind its upstream.
 *
 * Header lines are `# branch.oid <sha>|(initial)`, `# branch.head <name>|(detached)`, `# branch.upstream <ref>` and
 * `# branch.ab +<ahead> -<behind>`; the last two are absent without an upstream, and then ahead and behind are not known
 * (null), not zero. Every `1 `, `2 `, `u ` and `? ` line is one changed path (`! ` ignored ones are not asked for).
 */
export function parseBranchStatus(stdout: string): ProjectGitStatus {
  let head: string | null = null
  let oid: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  let dirty = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice('# branch.ab '.length).trim())
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (/^[12u?] /.test(line)) dirty++
  }
  // a detached HEAD is named by its commit, as git's own prompt does
  const branch = head === '(detached)' ? (oid && oid !== '(initial)' ? oid.slice(0, 7) : null) : head || null
  return { branch, dirty, unpushed: ahead, behind }
}

/** What a repository whose status could not be read reports: nothing is known. */
export const UNKNOWN_GIT_STATUS: ProjectGitStatus = { branch: null, dirty: null, unpushed: null, behind: null }
