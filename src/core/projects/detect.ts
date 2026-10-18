// W7-B: what an existing folder is, for `projects-add`: whether it is a git repository, whether it has a commit yet,
// its default branch, and a test command to propose from what is there. The owner confirms or edits the proposal; it is
// stored as a run configuration (`projects-set --test-command`), never here.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { detectPackageManager, type RunConfig } from '../run/config'
import { detectBaseRef, git } from '../worktrees/git'

/** The build files the proposal reads, by name. */
export interface DetectTexts {
  packageJson?: string | null
  makefile?: string | null
}

/** A test command for a project root, from its top-level file names and the bodies of its build files; null when
 *  nothing there names one. The first match wins: package.json, Makefile, Cargo.toml, go.mod, pyproject.toml. */
export function proposeTestCommand(files: readonly string[], texts: DetectTexts): string | null {
  const set = new Set(files)
  if (texts.packageJson) {
    let scripts: unknown
    try {
      scripts = (JSON.parse(texts.packageJson) as { scripts?: unknown } | null)?.scripts
    } catch {
      scripts = undefined
    }
    if (scripts && typeof scripts === 'object' && typeof (scripts as Record<string, unknown>).test === 'string') {
      const pm = detectPackageManager([...files])
      // `bun test` is bun's own runner, not the script, and `npm test` is npm's alias of `npm run test`
      return pm === 'bun' ? 'bun run test' : `${pm} test`
    }
  }
  if (texts.makefile && /^test\s*:/m.test(texts.makefile)) return 'make test'
  if (set.has('Cargo.toml')) return 'cargo test'
  if (set.has('go.mod')) return 'go test ./...'
  if (set.has('pyproject.toml')) return 'pytest'
  return null
}

export interface FolderReport {
  /** The repository's top level (the folder given, or the one holding it). */
  root: string
  hasCommit: boolean
  /** origin's default branch, else main/master, else the branch HEAD names (a repository with no commit yet). */
  defaultBranch: string | null
  proposedTest: string | null
}

/** Reads a folder for `projects-add`. Null when it is not inside a git repository. */
export async function inspectFolder(dir: string, run: typeof git = git): Promise<FolderReport | null> {
  const top = await run(['rev-parse', '--show-toplevel'], { cwd: dir })
  if (!top.ok || top.stdout === '') return null
  const root = path.resolve(top.stdout)
  const hasCommit = (await run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: root })).ok
  const base = hasCommit ? await detectBaseRef(root) : null
  const head = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root })
  const defaultBranch = base?.replace(/^origin\//, '') ?? (head.ok && head.stdout !== '' ? head.stdout : null)
  const files = await fs.readdir(root).catch(() => [] as string[])
  const read = (name: string): Promise<string | null> =>
    files.includes(name) ? fs.readFile(path.join(root, name), 'utf8').catch(() => null) : Promise.resolve(null)
  const [packageJson, makefile] = await Promise.all([read('package.json'), read('Makefile')])
  return { root, hasCommit, defaultBranch, proposedTest: proposeTestCommand(files, { packageJson, makefile }) }
}

/** The id of the run configuration `projects-set --test-command` saves: one per project, replaced on every save. */
export const TEST_CONFIG_ID = 'astera:test'

/** A project's stored run configurations with its test command set to `command` (null: removed). Answers the list to
 *  store and the test configuration's id, or null when there is none. */
export function withTestCommand(configs: readonly RunConfig[], command: string | null): { configs: RunConfig[]; id: string | null } {
  const rest = configs.filter((c) => c.id !== TEST_CONFIG_ID)
  if (command === null) return { configs: rest, id: null }
  return { configs: [...rest, { id: TEST_CONFIG_ID, name: 'Test', type: 'shell', command }], id: TEST_CONFIG_ID }
}
