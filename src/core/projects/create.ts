// W7-B: a brand-new project (`projects-create`). The folder is made, `git init -b main`, a `.gitignore` and a short
// `CLAUDE.md` are written from the owner's description, and the **initial commit** is made at once: a repository with
// no commit has no ref to fork a worktree from (core/worktrees/base.ts), so the first plan's Tasks could not run in
// parallel. The GitHub repository is outward-facing and made only when the owner asked (`githubCreate`).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GhRunner } from '../github/gh'
import { mergeIdentityArgs } from '../orchestration/exec/integrateGit'
import { validateName } from '../files/ops'
import { git, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'

export type GithubVisibility = 'private' | 'public'

/** The stacks a description can name, each with what its `.gitignore` leaves out. Matched as whole words. */
const STACKS: ReadonlyArray<{ name: string; words: RegExp; ignore: string[] }> = [
  { name: 'Node.js / TypeScript', words: /\b(node|nodejs|typescript|javascript|react|vue|svelte|next\.?js|electron|vite|npm|ts|js)\b/i, ignore: ['node_modules/', 'dist/', 'out/', 'coverage/', '*.tsbuildinfo'] },
  { name: 'Python', words: /\b(python|django|flask|fastapi|pytest|py)\b/i, ignore: ['__pycache__/', '*.pyc', '.venv/', '.pytest_cache/', '*.egg-info/'] },
  { name: 'Rust', words: /\b(rust|cargo)\b/i, ignore: ['target/'] },
  { name: 'Go', words: /\b(go|golang)\b/i, ignore: ['bin/'] },
  { name: 'Java / Kotlin', words: /\b(java|kotlin|gradle|maven|spring)\b/i, ignore: ['build/', '.gradle/', 'target/'] }
]

const ALWAYS_IGNORED = ['.env', '.env.*', '!.env.example', '.DS_Store', '*.log', '.idea/', '.vscode/']

const stacksOf = (describe: string): typeof STACKS => STACKS.filter((s) => s.words.test(describe))

/** The `.gitignore` of a new project: what every project leaves out, plus what each stack the description names does. */
export function gitignoreFor(describe: string): string {
  const lines = [...ALWAYS_IGNORED, ...new Set(stacksOf(describe).flatMap((s) => s.ignore))]
  return lines.join('\n') + '\n'
}

/** The short `CLAUDE.md` of a new project: what it is, its stack, its conventions, and the GitHub rules agents follow. */
export function claudeMdFor(name: string, describe: string): string {
  const stacks = stacksOf(describe).map((s) => s.name)
  return [
    `# ${name}`,
    '',
    describe.trim() || 'A new project.',
    '',
    '## Stack',
    '',
    stacks.length > 0 ? stacks.map((s) => `- ${s}`).join('\n') : '- Not chosen yet. Pick the simplest stack that fits and write it here.',
    '',
    '## Conventions',
    '',
    '- Keep changes small and focused; one concern per commit.',
    '- Tests live next to the code they test. Add one for every new behaviour.',
    '- Follow the GitHub rules below.',
    '',
    '## GitHub rules',
    '',
    '- `main` is the default branch. Work on a branch per task and open a pull request into `main`.',
    '- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, ...).',
    '- A pull request that resolves an issue says `Fixes #<n>` in its body.',
    '- Before creating an issue, search the open and closed ones; never file a duplicate.',
    '- Never force-push `main`, and never commit secrets (`.env` is ignored).',
    ''
  ].join('\n')
}

/** `git add -A` and the first commit, with Astera's fallback identity only where git has none (`mergeIdentityArgs`). */
export async function initialCommit(root: string, run: typeof git = git): Promise<void> {
  const add = await run(['add', '-A'], { cwd: root, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!add.ok) throw new Error(`git add failed: ${add.stderr || add.errorCode || 'no answer'}`)
  const identity = await mergeIdentityArgs(root, run)
  const commit = await run([...identity, 'commit', '--allow-empty', '-m', 'Initial commit'], { cwd: root, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr || commit.errorCode || 'no answer'}`)
}

async function gitInit(root: string, run: typeof git): Promise<void> {
  const init = await run(['init', '-b', 'main'], { cwd: root })
  if (!init.ok) throw new Error(`git init failed: ${init.stderr || init.errorCode || 'no answer'}`)
}

/** Makes an existing folder with no repository one: `git init -b main`, a `.gitignore` only where there is none, and
 *  the initial commit of what is there. Nothing existing is overwritten. Throws git's own words. */
export async function initGitFolder(root: string, run: typeof git = git): Promise<void> {
  await gitInit(root, run)
  await fs.writeFile(path.join(root, '.gitignore'), gitignoreFor(''), { encoding: 'utf8', flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  await initialCommit(root, run)
}

/** Makes the folder `parent/name` (it must not exist yet), `git init -b main`, writes `.gitignore` and `CLAUDE.md` from
 *  `describe`, and makes the initial commit. Throws the refusal's sentence. Answers the new folder. */
export async function createProjectFolder(
  req: { name: string; parent: string; describe?: string },
  run: typeof git = git
): Promise<string> {
  const name = req.name.trim()
  if (validateName(name) !== null || name.startsWith('-')) throw new Error(`not a folder name: ${JSON.stringify(req.name)}`)
  if (!path.isAbsolute(req.parent)) throw new Error('--parent must be an absolute path')
  if (!(await fs.stat(req.parent).then((st) => st.isDirectory(), () => false))) throw new Error(`not a folder on this machine: ${req.parent}`)
  const root = path.join(req.parent, name)
  try {
    await fs.mkdir(root)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${root} already exists; add it as an existing project instead`)
    throw e
  }
  await gitInit(root, run)
  const describe = req.describe ?? ''
  await fs.writeFile(path.join(root, '.gitignore'), gitignoreFor(describe), 'utf8')
  await fs.writeFile(path.join(root, 'CLAUDE.md'), claudeMdFor(name, describe), 'utf8')
  await initialCommit(root, run)
  return root
}

/** `gh repo create <name> --private|--public --source . --push` in the new folder. Answers the repository's URL. */
export async function githubCreate(gh: GhRunner, root: string, name: string, visibility: GithubVisibility): Promise<string> {
  const r = await gh(['repo', 'create', name, `--${visibility}`, '--source', '.', '--push'], root)
  if (!r.ok) throw new Error(`gh repo create failed: ${r.stderr || 'no answer'}`)
  return r.stdout.split('\n').find((l) => l.startsWith('https://')) ?? r.stdout
}

// T12b: `projects-add --clone <url>`, sent to a Runtime by a full-control controller (or typed on that machine): the
// machine clones with its own git credentials, then registers the folder as `projects-add --path` does.
const CLONE_URL = /^(?:(?:https?|ssh|git|file):\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/

/** Why a clone URL is refused, or null: only plain https, ssh, git, file and user@host:path URLs, never an option. */
export function cloneUrlRefusal(url: unknown): string | null {
  return typeof url === 'string' && CLONE_URL.test(url) ? null : '--clone needs a git URL (https://…, ssh://… or user@host:path)'
}

/** Where a clone with no --path goes: <home>/astera-projects/<repository name>. */
export function cloneDestination(url: string, home: string): string {
  const name = (url.replace(/[/\\]+$/, '').split(/[/:\\]/).pop() ?? '').replace(/\.git$/i, '')
  return path.join(home, 'astera-projects', validateName(name) === null && name !== '' ? name : 'project')
}

/** Clones `url` into `dest`, which must not exist yet; throws git's own words when it fails. */
export async function cloneRepository(url: string, dest: string): Promise<void> {
  if (await fs.stat(dest).then(() => true, () => false)) throw new Error(`${dest} already exists; give another --path`)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const r = await git(['-c', 'protocol.ext.allow=never', 'clone', '--', url, dest], { timeoutMs: GIT_WRITE_TIMEOUT_MS })
  if (!r.ok) throw new Error(`git clone failed: ${r.stderr.trim() || 'no reason given'}`)
}
