import { git as realGit, GIT_WRITE_TIMEOUT_MS, ORIGIN_FETCH_TIMEOUT_MS } from '../worktrees/git'

export type BranchCreateResult =
  | { ok: true; name: string; from: string; pushed: boolean; pushError?: string }
  | { ok: false; reason: string }

const say = (r: { stderr: string; stdout: string }, fallback: string): string => (r.stderr || r.stdout).trim() || fallback

/** Creates a local branch `name` from `from` (default: the repository default branch) and publishes it to origin when
 *  there is one. It is never forced; a failed publish leaves the local branch and answers `pushed: false` with the
 *  reason. Never throws. */
export async function createBranch(
  { cwd, name, from }: { cwd: string; name: string; from?: string },
  git: typeof realGit = realGit
): Promise<BranchCreateResult> {
  // `--branch` also expands `@{-1}` to a branch name, so that form is refused before it is asked
  const valid = !name.includes('@{') && (await git(['check-ref-format', '--branch', name], { cwd })).stdout === name
  if (!valid) return { ok: false, reason: `not a valid branch name: ${JSON.stringify(name)}` }
  if ((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd })).ok)
    return { ok: false, reason: `branch ${name} already exists` }

  const hasOrigin = (await git(['remote'], { cwd })).stdout.split('\n').some((l) => l.trim() === 'origin')
  const base = (from?.trim() || (await defaultBranch(cwd, git))).replace(/^origin\//, '')
  // offline or no such branch on origin is not fatal: the local base is used
  if (hasOrigin) await git(['fetch', '--no-tags', 'origin', base], { cwd, timeoutMs: ORIGIN_FETCH_TIMEOUT_MS })
  const start = await firstCommitRef(cwd, git, [`refs/remotes/origin/${base}`, `refs/heads/${base}`, base])
  if (!start) return { ok: false, reason: `unknown base: ${base}` }

  const made = await git(['branch', '--no-track', name, start], { cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!made.ok) return { ok: false, reason: say(made, 'git branch failed') }
  const shown = start.replace(/^refs\/(heads|remotes)\//, '')
  if (!hasOrigin) return { ok: true, name, from: shown, pushed: false }
  const sent = await git(['push', '-u', 'origin', name], { cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  return sent.ok
    ? { ok: true, name, from: shown, pushed: true }
    : { ok: true, name, from: shown, pushed: false, pushError: say(sent, 'git push failed') }
}

/** origin/HEAD's branch, else the checked-out branch, else HEAD. */
async function defaultBranch(cwd: string, git: typeof realGit): Promise<string> {
  const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd })
  if (head.ok && head.stdout) return head.stdout
  const cur = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
  return cur.ok && cur.stdout ? cur.stdout : 'HEAD'
}

async function firstCommitRef(cwd: string, git: typeof realGit, refs: string[]): Promise<string | null> {
  for (const ref of refs) if ((await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd })).ok) return ref
  return null
}
