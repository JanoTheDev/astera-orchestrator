// The Files page's Changed view: the rows of git's changed files, flat, from the explorer's own git status plus, for a
// plan's worktree, the files changed against its base branch (worktrees.detail → readChanges).
import type { ChangedFile } from '../../../core/git/changedFile'
import type { GitState } from '../../../core/git/status'

export interface ChangedRow {
  /** absolute, the key useGitStatus and the tree use */
  path: string
  name: string
  /** folder below the root, forward slashes; '' for a file in the root */
  dir: string
  state: GitState
  /** set when the file came from the base-branch list: readFileDiff can show its diff (worktrees.fileDiff takes this id) */
  fileId?: string
  binary?: true
  /** git reports the file renamed: its state stays modified, the row shows R and the Renamed label */
  renamed?: true
}

const STATE_OF: Record<ChangedFile['status'], GitState> = { added: 'new', deleted: 'deleted', modified: 'modified', renamed: 'modified' }

/** Uncommitted files (`fileState`) joined with the files changed against the base (`base`, null when the root is no
 *  worktree). A file in both keeps the badge the tree shows; sorted by folder, then name. */
export function changedRows(root: string, fileState: Record<string, GitState>, base: ChangedFile[] | null): ChangedRow[] {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const rows = new Map<string, ChangedRow>()
  const add = (path: string, state: GitState, extra: Partial<ChangedRow> = {}): void => {
    const rel = path.slice(root.length + 1).replace(/\\/g, '/')
    const cut = rel.lastIndexOf('/')
    rows.set(path, { path, name: rel.slice(cut + 1), dir: cut < 0 ? '' : rel.slice(0, cut), state, ...extra })
  }
  for (const [path, state] of Object.entries(fileState)) add(path, state)
  for (const f of base ?? []) {
    const path = root + sep + f.path.split('/').join(sep)
    add(path, fileState[path] ?? STATE_OF[f.status], {
      fileId: f.id,
      ...(f.binary ? { binary: true as const } : {}),
      ...(f.status === 'renamed' ? { renamed: true as const } : {})
    })
  }
  return [...rows.values()].sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name))
}

/** A changed file's state as git's list or the base-branch list words it. */
export type ChangeKind = GitState | ChangedFile['status']

const LETTER: Record<ChangeKind, 'A' | 'M' | 'D' | 'R' | 'C'> = {
  new: 'A', added: 'A', modified: 'M', deleted: 'D', renamed: 'R', conflict: 'C'
}

/** The status letter on a Changed row: A added (or untracked), M modified, D deleted, R renamed, C conflict. Colour
 *  comes with it (`git-<state>`), and the word goes in the tooltip, so colour is never the only cue. */
export const changeLetter = (kind: ChangeKind): 'A' | 'M' | 'D' | 'R' | 'C' => LETTER[kind]
