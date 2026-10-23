// The skills finder's catalog: GitHub repos holding `<dir>/SKILL.md` folders (anthropics/skills by
// default, plus repos the person adds). Read over HTTPS from the trees API and raw.githubusercontent.com,
// pinned to one commit so the files installed are the files that were listed.
//
// Names and paths come from someone else's repo and become folders under an account's config dir, so
// each one must be a single safe path segment, and a skill is capped in files and bytes.

export const DEFAULT_SKILL_REPO = 'anthropics/skills'
export const SKILL_MAX_FILES = 200
export const SKILL_MAX_BYTES = 2 * 1024 * 1024
/** Written into every folder the finder installs; only folders holding it are removed or replaced. */
export const FINDER_MARKER = '.astera-finder.json'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A skill folder in a repo with the files to download (paths relative to the folder). */
export interface SkillSource {
  repo: string
  commit: string
  path: string
  name: string
  files: { path: string; size: number }[]
}

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
export const isRepo = (s: string): boolean => REPO.test(s) && !s.split('/').some((p) => p === '.' || p === '..')

/** The added-repos setting, narrowed: valid `owner/repo` strings, each once. */
export function skillReposOf(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && isRepo(x)))]
}

/** One folder or file name: not empty, not `.`/`..`, no separator, drive colon or NUL, and not the
 *  finder's own marker (a repo must not be able to plant it). */
export function isSafeSegment(s: string): boolean {
  return s !== '' && s !== '.' && s !== '..' && s.length <= 255 && !/[/\\:\0]/.test(s) && s !== FINDER_MARKER
}

const SHA = /^[0-9a-f]{40}$/
/** The commit sha of `GET /repos/{repo}/commits/HEAD`. */
export function commitShaOf(json: unknown): string | null {
  const sha = isObject(json) ? str(json.sha) : ''
  return SHA.test(sha) ? sha : null
}

export const commitUrl = (repo: string): string => `https://api.github.com/repos/${repo}/commits/HEAD`
export const treeUrl = (repo: string, commit: string): string =>
  `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`
export const rawUrl = (repo: string, commit: string, filePath: string): string =>
  `https://raw.githubusercontent.com/${repo}/${commit}/${filePath.split('/').map(encodeURIComponent).join('/')}`

/** Every `<dir>/SKILL.md` in a recursive tree, with the regular files under `<dir>`. A skill whose
 *  name or any file path is not made of safe segments, or that is over the caps, is left out; symlinks
 *  and submodules are never downloaded. A truncated tree gives what it holds. */
export function skillSourcesFromTree(repo: string, commit: string, json: unknown): SkillSource[] {
  if (!isObject(json) || !Array.isArray(json.tree)) return []
  const blobs = json.tree
    .filter(isObject)
    .filter((t) => t.type === 'blob' && t.mode !== '120000' && typeof t.path === 'string')
    .map((t) => ({ path: str(t.path), size: typeof t.size === 'number' ? t.size : 0 }))
  return blobs.flatMap((b): SkillSource[] => {
    if (!b.path.endsWith('/SKILL.md')) return []
    const dir = b.path.slice(0, -'/SKILL.md'.length)
    if (!dir.split('/').every(isSafeSegment)) return []
    const files = blobs
      .filter((f) => f.path.startsWith(dir + '/'))
      .map((f) => ({ path: f.path.slice(dir.length + 1), size: f.size }))
    if (!files.every((f) => f.path.split('/').every(isSafeSegment))) return []
    if (files.length > SKILL_MAX_FILES || files.reduce((n, f) => n + f.size, 0) > SKILL_MAX_BYTES) return []
    return [{ repo, commit, path: dir, name: dir.split('/').pop() ?? dir, files }]
  })
}

/** `name` and `description` of a SKILL.md's front matter.
 *  shortcut: one-line `key: value` only (quotes stripped); a YAML block scalar reads as its marker.
 *  Upgrade to a YAML parser if skills in the wild use folded descriptions. */
export function frontMatterOf(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line)
    if (kv) out[kv[1] as 'name' | 'description'] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

/** The marker's content, or null when there is none or it is not one. */
export function finderMarkerOf(text: string | null): { repo: string; path: string; commit: string } | null {
  if (text === null) return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(v) || !str(v.repo) || !str(v.path) || !str(v.commit)) return null
  return { repo: str(v.repo), path: str(v.path), commit: str(v.commit) }
}
