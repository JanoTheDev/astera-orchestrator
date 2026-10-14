// @ts-check
// An Astera completion check that fails a Task whose changes add a debug leftover: a `console.log`, a `debugger`, a
// `TODO` or a `FIXME`, or whatever text its `patterns` setting names. Each one is a finding at its file and line, which
// Astera hands the Task's worker in its repair request, so the worker takes it out and the recheck passes.
//
// It reads the Task's changes with one `git diff`, in the folder the Task's checks run in: what that folder holds now
// against the commit the Task's work started from, only the lines it adds. New files git does not ignore are in it too,
// marked as intended (`git add -N`) in a copy of the index, so a file moved without `git add` reads as a move and the
// person's own index is never touched. A leftover from before the Task, or a line the Task removes, is not the Task's.
//
// Plain JavaScript with no dependency, so its folder installs as it is. The types are the plugin SDK's, for your editor
// and tsc only: Astera never loads @astera-app/plugin-sdk, and a plain object is the provider
// `defineCompletionCheckProvider` would have returned.

import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** @typedef {import('@astera-app/plugin-sdk').CompletionCheckProvider} CompletionCheckProvider */
/** @typedef {import('@astera-app/plugin-sdk').CompletionCheckDiagnostic} CompletionCheckDiagnostic */

/** What it looks for when its setting names nothing. */
const DEFAULT_PATTERNS = ['console.log', 'debugger', 'TODO', 'FIXME']
/** Astera keeps the first 100 findings of an answer, so more would only be cut; the summary counts them all. */
const FINDINGS_MAX = 100
/** A new file larger than this is not read: a file that size was generated, not written. */
const NEW_FILE_MAX = 1_000_000
/** How much of git's complaint is kept. */
const STDERR_MAX = 4_000
/** Windows refuses to start a process for a moment when many start at once: nothing ran, so one more try is safe. */
const SPAWN_REFUSED = new Set(['EPERM', 'EBUSY'])

/** The patterns to look for: the setting's, comma separated, or the defaults when it names none. */
function patternsOf(/** @type {unknown} */ setting) {
  const named = typeof setting === 'string' ? setting.split(',').map((p) => p.trim()).filter((p) => p !== '') : []
  return named.length > 0 ? named : DEFAULT_PATTERNS
}

/** `1 thing`, `2 things`. */
const count = (/** @type {number} */ n, /** @type {string} */ thing) => `${n} ${thing}${n === 1 ? '' : 's'}`

/** The C escapes git writes in a quoted name, other than a byte's octal one. */
const ESCAPES = /** @type {Record<string, number>} */ ({ a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 })

/**
 * A name as git prints it, back as it is on disk. git puts a name that holds a quote, a backslash or a control
 * character in double quotes, with C escapes and each such byte in octal; the rest comes as it is (core.quotepath is off
 * here, so a letter outside ASCII is not escaped).
 * @param {string} name
 */
function unquote(name) {
  if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) return name
  const inner = name.slice(1, -1)
  /** @type {Buffer[]} */
  const parts = []
  let last = 0
  for (const m of inner.matchAll(/\\([0-7]{3}|[\s\S])/g)) {
    const at = m.index ?? 0
    parts.push(Buffer.from(inner.slice(last, at), 'utf8'))
    const e = m[1]
    parts.push(Buffer.from([/^[0-7]{3}$/.test(e) ? parseInt(e, 8) : (ESCAPES[e] ?? e.charCodeAt(0))]))
    last = at + m[0].length
  }
  parts.push(Buffer.from(inner.slice(last), 'utf8'))
  return Buffer.concat(parts).toString('utf8')
}

/** git's sentence: its first `fatal:` or `error:` line, else its first line (a warning, say). */
function complaintOf(/** @type {string} */ stderr) {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  return lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0]
}

/**
 * @typedef {object} GitRun
 * @property {AbortSignal} signal
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [input] what git reads on its standard input
 * @property {'\n' | '\0'} [sep] what ends an item of its output: a line, or a NUL with `-z`
 */

/**
 * Runs git once in `cwd`, handing each item it prints to `onItem`. A line ends at a line feed only, one carriage return
 * before it dropped: git does not end a line at a lone carriage return, and nor does this. Resolves when git ends well;
 * rejects with git's sentence when it fails, or with the error that kept it from starting.
 * @param {string} cwd
 * @param {string[]} args
 * @param {GitRun} run
 * @param {(item: string) => void} onItem
 * @returns {Promise<void>}
 */
function gitOnce(cwd, args, run, onItem) {
  return new Promise((resolve, reject) => {
    // Names as they are, and the a/ b/ prefixes this file reads, whatever the repository's own config says
    const config = ['-c', 'core.quotepath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false']
    const child = spawn('git', [...config, ...args], {
      cwd,
      env: run.env ?? process.env,
      signal: run.signal,
      windowsHide: true,
      stdio: [run.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const sep = run.sep ?? '\n'
    let rest = ''
    const item = (/** @type {string} */ text) => onItem(sep === '\n' && text.endsWith('\r') ? text.slice(0, -1) : text)
    // Both are pipes, as stdio says
    const out = /** @type {import('node:stream').Readable} */ (child.stdout)
    const err = /** @type {import('node:stream').Readable} */ (child.stderr)
    out.setEncoding('utf8').on('data', (/** @type {string} */ chunk) => {
      const items = (rest + chunk).split(sep)
      rest = items.pop() ?? ''
      items.forEach(item)
    })
    let stderr = ''
    err.setEncoding('utf8').on('data', (/** @type {string} */ chunk) => {
      if (stderr.length < STDERR_MAX) stderr += chunk
    })
    if (child.stdin !== null) {
      child.stdin.on('error', () => {})
      child.stdin.end(run.input)
    }
    child.once('error', reject)
    // 'close' comes after the output has all been read
    child.once('close', (code) => {
      if (rest !== '') item(rest)
      if (code === 0) resolve()
      else reject(new Error(`git ${args[0]}: ${complaintOf(stderr) ?? `exit ${code}`}`))
    })
  })
}

/** The code a system error carries (`ENOENT`), if it carries one. */
const codeOf = (/** @type {unknown} */ e) => (e instanceof Error ? /** @type {{ code?: unknown }} */ (e).code : undefined)

/**
 * gitOnce, tried once more when the system refused to start git.
 * @param {string} cwd
 * @param {string[]} args
 * @param {GitRun} run
 * @param {(item: string) => void} [onItem]
 */
async function git(cwd, args, run, onItem = () => {}) {
  try {
    await gitOnce(cwd, args, run, onItem)
  } catch (e) {
    const code = codeOf(e)
    if (typeof code !== 'string' || !SPAWN_REFUSED.has(code)) throw e
    await new Promise((r) => setTimeout(r, 50))
    await gitOnce(cwd, args, run, onItem)
  }
}

/**
 * The commit to read the Task's changes against: its own, else HEAD, else (a repository with no commit yet) the empty
 * tree, so everything in it is the Task's.
 * @param {string} root
 * @param {string | undefined} base
 * @param {AbortSignal} signal
 */
async function baseOf(root, base, signal) {
  if (base !== undefined) return base
  const committed = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { signal }).then(
    () => true,
    () => false
  )
  if (committed) return 'HEAD'
  let empty = ''
  await git(root, ['hash-object', '-t', 'tree', '--stdin'], { signal, input: '' }, (line) => (empty ||= line))
  return empty
}

/** @type {CompletionCheckProvider} */
export default {
  async runCheck(input, ctx) {
    const root = input.workspace.root
    const isFolder = await stat(root).then(
      (s) => s.isDirectory(),
      () => false
    )
    if (!isFolder) return { status: 'error', summary: `the Task’s folder is not there: ${root}` }
    const patterns = patternsOf(ctx.settings.patterns)
    /** @type {CompletionCheckDiagnostic[]} */
    const diagnostics = []
    /** @type {Set<string>} */
    const withFindings = new Set()
    let total = 0
    let changed = 0
    /** One line the Task adds, a finding when it holds a pattern: the first, in the setting's order. */
    const added = (/** @type {string} */ file, /** @type {number} */ line, /** @type {string} */ text) => {
      const pattern = patterns.find((p) => text.includes(p))
      if (pattern === undefined) return
      total++
      withFindings.add(file)
      if (diagnostics.length < FINDINGS_MAX) diagnostics.push({ file, line, message: `adds ${pattern}`, severity: 'error' })
    }

    /** @type {string | null} */
    let scratch = null
    try {
      const signal = ctx.signal
      // A copy of the index (the person's own is not touched), with the new files git does not ignore marked as intended
      let real = ''
      await git(root, ['rev-parse', '--git-path', 'index'], { signal }, (line) => (real ||= line))
      const base = await baseOf(root, input.workspace.base, signal)
      scratch = await mkdtemp(path.join(os.tmpdir(), 'astera-leftovers-'))
      const index = path.join(scratch, 'index')
      // A repository with nothing staged yet has no index: the copy then starts empty
      await copyFile(path.resolve(root, real), index).catch(() => {})
      const env = { ...process.env, GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: '1' }
      /** @type {string[]} */
      const fresh = []
      await git(root, ['ls-files', '-z', '--others', '--exclude-standard'], { signal, env, sep: '\0' }, (name) => {
        if (name !== '') fresh.push(name)
      })
      /** @type {string[]} */
      const small = []
      for (const name of fresh) {
        // A link is read as git reads it, its own text, never the file it points at
        const info = await lstat(path.join(root, name)).catch(() => null)
        if (info !== null && (info.isFile() || info.isSymbolicLink()) && info.size <= NEW_FILE_MAX) small.push(name)
      }
      if (small.length > 0)
        await git(root, ['add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'], { signal, env, input: `${small.join('\0')}\0` })

      // The lines the Task adds, named from the folder and only the folder's (--relative); renames found and a
      // submodule read as its commit, whatever the config says; no colour, external tool or text conversion. Context
      // lines are counted, as GIT_DIFF_OPTS can ask git for them whatever --unified says.
      /** @type {string | null} */
      let file = null
      let header = false
      let next = 0
      const diff = [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--relative',
        '--find-renames',
        '--submodule=short',
        '--unified=0',
        '--inter-hunk-context=0',
        '--src-prefix=a/',
        '--dst-prefix=b/'
      ]
      await git(root, [...diff, base, '--'], { signal, env }, (line) => {
        if (line.startsWith('diff --git ')) {
          changed++
          file = null
          header = true
          return
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunk !== null) {
          header = false
          next = Number(hunk[1])
          return
        }
        if (header) {
          // A name with a space ends in a tab; /dev/null is a file the Task deleted. An added line that starts with
          // `++` is past the header, so it is not read as a name.
          if (line.startsWith('+++ ')) {
            const name = unquote(line.slice(4).replace(/\t$/, ''))
            file = name.startsWith('b/') ? name.slice(2) : null
          }
          return
        }
        // In a hunk: `+` is a line the Task adds, ` ` (or nothing, with diff.suppressBlankEmpty) a line it kept, and
        // `-` and `\` take no line on the new side
        if (line.startsWith('+')) {
          if (file !== null) added(file, next, line.slice(1))
          next++
        } else if (line === '' || line.startsWith(' ')) next++
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (codeOf(e) === 'ENOENT') return { status: 'error', summary: `git could not be started: is it installed, and on the PATH Astera runs with? (${message})` }
      return { status: 'error', summary: message }
    } finally {
      if (scratch !== null) await rm(scratch, { recursive: true, force: true })
    }

    if (total === 0) return { status: 'passed', summary: `no debug leftovers in ${count(changed, 'changed file')}` }
    return { status: 'failed', summary: `${count(total, 'debug leftover')} in ${count(withFindings.size, 'file')}`, diagnostics }
  }
}
