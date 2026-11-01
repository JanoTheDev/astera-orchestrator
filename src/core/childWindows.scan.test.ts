// Regression guard for console windows on win32: every child-process start in src/main, src/cli, src/core and
// src/host names `windowsHide` in its own argument list, or sits on the allowlist below with the reason it may not.
//
// The global guards (src/core/childWindows.ts) cover the Host, the CLI and Electron main at runtime. This scan is
// the second line: it keeps each call site honest, so that code moved to a process without a guard, or a sync start
// in the Host (which its guard does not reach), still opens no window.
//
// Text-based on purpose: the repository has no TypeScript AST API at hand (typescript 7 is the native compiler), and
// the shapes to recognise are few: an import from `node:child_process`, an optional `promisify` alias, and the call
// itself. Comments and string contents are blanked first, so a call named in prose, or one inside a script held in a
// string, is not counted.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The `node:child_process` functions that start a process. */
const CHILD_STARTERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const

interface ChildCall {
  /** 1-based line of the call. */
  line: number
  /** The `child_process` function the call reaches, e.g. `execFile` for a promisified alias. */
  fn: string
  /** The call's source text, from the callee to its closing parenthesis. */
  text: string
  /** Whether the call's own argument list names `windowsHide`. */
  hidden: boolean
}

/**
 * `src` with comments and the contents of string and template literals replaced by spaces, keeping every newline and
 * offset. A template's `${…}` expressions stay code. Regex literals are not recognised; none next to a child-process
 * call holds an unbalanced quote or parenthesis.
 */
function blankNonCode(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  /** One entry per open template literal: the brace depth inside its current `${`, 0 while in its text. */
  const templates: number[] = []
  const n = src.length
  let i = 0
  const templateText = (): void => {
    const start = i
    while (i < n) {
      if (src[i] === '\\') {
        i += 2
        continue
      }
      if (src[i] === '`') {
        blank(start, i)
        i++
        templates.pop()
        return
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(start, i)
        i += 2
        templates[templates.length - 1] = 1
        return
      }
      i++
    }
    blank(start, n)
  }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? n : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"') {
      const start = ++i
      while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1
      blank(start, i)
      i++
    } else if (c === '`') {
      templates.push(0)
      i++
      templateText()
    } else {
      const top = templates.length - 1
      if (top >= 0 && templates[top] > 0) {
        if (c === '{') templates[top]++
        else if (c === '}' && --templates[top] === 0) {
          i++
          templateText()
          continue
        }
      }
      i++
    }
  }
  return out.join('')
}

const IMPORT_RE = /import\s+(type\s+)?([^'";]*?)\s+from\s+['"](?:node:)?child_process['"]/g
const REQUIRE_RE = /(?:const|let|var)\s+([^=;]*?)\s*=\s*(?:await\s+import|require)\(\s*['"](?:node:)?child_process['"]\s*\)/g

/** The local names `src` binds to child-process starters (`local → fn`), and to the module object itself. */
function childProcessBindings(src: string): { fns: Map<string, string>; modules: Set<string> } {
  const fns = new Map<string, string>()
  const modules = new Set<string>()
  const addClause = (clause: string): void => {
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) {
      for (const raw of braces[1].split(',')) {
        const spec = raw.trim()
        if (!spec || spec.startsWith('type ')) continue
        const m = /^(\w+)(?:\s*(?:as|:)\s*(\w+))?$/.exec(spec)
        if (m && (CHILD_STARTERS as readonly string[]).includes(m[1])) fns.set(m[2] ?? m[1], m[1])
      }
    }
    const ns = /\*\s*as\s+(\w+)/.exec(clause)
    if (ns) modules.add(ns[1])
    const def = /^\s*(\w+)\s*(?:,|$)/.exec(clause)
    if (def) modules.add(def[1])
  }
  for (const m of src.matchAll(IMPORT_RE)) if (!m[1]) addClause(m[2])
  for (const m of src.matchAll(REQUIRE_RE)) addClause(m[1])
  // `const execFileP = promisify(execFile)`: the alias reaches the same function.
  for (const [local, fn] of [...fns])
    for (const m of src.matchAll(new RegExp(`(\\w+)\\s*=\\s*(?:util\\.)?promisify\\(\\s*${local}\\s*\\)`, 'g'))) fns.set(m[1], fn)
  for (const mod of modules)
    for (const fn of CHILD_STARTERS)
      for (const m of src.matchAll(new RegExp(`(\\w+)\\s*=\\s*(?:util\\.)?promisify\\(\\s*${mod}\\.${fn}\\s*\\)`, 'g'))) fns.set(m[1], fn)
  return { fns, modules }
}

/** Every call in `src` that starts a child process through `node:child_process`. */
function findChildCalls(src: string): ChildCall[] {
  const { fns, modules } = childProcessBindings(src)
  const code = blankNonCode(src)
  const patterns: Array<{ re: RegExp; fn: (m: RegExpExecArray) => string }> = []
  // Not a member access (`x.spawn(`), so a method of the same name on another object is not counted.
  if (fns.size > 0) patterns.push({ re: new RegExp(`(?<![\\w.$])(${[...fns.keys()].join('|')})\\s*\\(`, 'g'), fn: (m) => fns.get(m[1])! })
  if (modules.size > 0)
    patterns.push({
      re: new RegExp(`(?<![\\w.$])(?:${[...modules].join('|')})\\.(${CHILD_STARTERS.join('|')})\\s*\\(`, 'g'),
      fn: (m) => m[1]
    })
  const calls: ChildCall[] = []
  for (const { re, fn } of patterns) {
    for (let m = re.exec(code); m; m = re.exec(code)) {
      if (/function\s*\*?\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue // a declaration
      const open = m.index + m[0].length - 1
      let depth = 0
      let close = open
      for (; close < code.length; close++) {
        if (code[close] === '(') depth++
        else if (code[close] === ')' && --depth === 0) break
      }
      calls.push({
        line: src.slice(0, m.index).split('\n').length,
        fn: fn(m),
        text: src.slice(m.index, close + 1),
        hidden: /\bwindowsHide\b/.test(code.slice(m.index, close + 1))
      })
    }
  }
  return calls.sort((a, b) => a.line - b.line)
}

/**
 * Calls that may pass no `windowsHide` of their own, each with why. `match` is a piece of the call's text (whitespace
 * collapsed), so an entry follows its call when lines move; every entry must still match a call (no stale entries).
 */
const ALLOWED: Array<{ file: string; match: string; reason: string }> = [
  {
    file: 'src/main/core.ts',
    match: 'execFile(file, args, options, callback)',
    reason: "the default of an injectable execFile: it forwards options whose type requires windowsHide, and its one caller passes it"
  },
  {
    file: 'src/core/secrets/winAcl.ts',
    match: 'execRun(file, args, o)',
    reason: 'forwards options whose type (Run) requires windowsHide; every caller passes it'
  },
  {
    file: 'src/host/gatewaySupervisor.ts',
    match: 'nodeSpawn(exec, args, opts)',
    reason: 'forwards GatewaySpawnOptions, whose type requires windowsHide: true'
  },
  {
    file: 'src/host/mcpHttp.ts',
    match: 'nodeSpawn(exec, args, opts)',
    reason: 'forwards McpHttpSpawnOptions, whose type requires windowsHide: true'
  },
  {
    file: 'src/host/loadMonitor.ts',
    match: 'nodeSpawn(file, args, opts)',
    reason: 'forwards CommitSpawn options, whose type requires windowsHide: true'
  },
  {
    file: 'src/main/ipc.ts',
    match: 'spawn(plan.command, plan.args, { ...plan.options',
    reason: 'the Host start: its options come from hostSpawnPlan (src/core/host/spawn.ts), which sets windowsHide'
  },
  {
    file: 'src/cli/host.ts',
    match: 'spawn(plan.command, plan.args, { ...plan.options',
    reason: 'the Host start: its options come from hostSpawnPlan (src/core/host/spawn.ts), which sets windowsHide'
  },
  {
    file: 'src/cli/run.ts',
    match: 'spawn(planned.plan.command, planned.plan.args, { ...planned.plan.options',
    reason: 'the Host start: its options come from hostSpawnPlan (src/core/host/spawn.ts), which sets windowsHide'
  },
  { file: 'src/main/loginPath.ts', match: 'spawn(file, args, { detached: true', reason: 'posix-only: the login-shell probe (runDetached), never reached on win32' },
  { file: 'src/main/manualInstall.ts', match: 'execFileAsync(file, args)', reason: 'macOS-only: runs ditto and xattr' },
  { file: 'src/core/orchestration/heavyLock.ts', match: "spawn('flock'", reason: 'posix-only: win32 takes the slot by file (takeHeavySlotByFile)' },
  { file: 'src/host/workspace/posixProc.ts', match: 'execFile(file, args, { timeout: timeoutMs }', reason: 'posix-only module (the workspace tools on Linux and macOS)' },
  { file: 'src/host/workspace/posixProc.ts', match: 'spawn(file, args, { env: o.env', reason: 'posix-only module (the workspace tools on Linux and macOS)' },
  { file: 'src/host/workspace/posixProc.ts', match: "execFile(file, args, { env, encoding: 'buffer'", reason: 'posix-only module (the workspace tools on Linux and macOS)' }
]

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['main', 'cli', 'core', 'host']

/** Non-test TypeScript under `dir`: `*.test.ts` and the `*.testutil.ts` helpers only tests import are left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) return e === '__fixtures__' || e === 'node_modules' ? [] : sources(p)
    return /\.tsx?$/.test(e) && !/\.(test|testutil|d)\.tsx?$/.test(e) ? [p] : []
  })
}

const squash = (s: string): string => s.replace(/\s+/g, ' ')

describe('every child-process start passes windowsHide (win32 console windows)', () => {
  const found = ROOTS.flatMap((root) =>
    sources(path.join(SRC, root)).flatMap((abs) => {
      const file = path.relative(path.join(SRC, '..'), abs).split(path.sep).join('/')
      return findChildCalls(readFileSync(abs, 'utf8')).map((c) => ({ file, ...c }))
    })
  )

  it('finds the call sites at all', () => {
    // A scan that silently matched nothing would pass forever. There are dozens; a floor well below that.
    expect(found.length).toBeGreaterThan(40)
    expect(found.some((c) => c.file === 'src/core/worktrees/git.ts')).toBe(true)
  })

  it('has no start without windowsHide outside the allowlist', () => {
    const bare = found.filter((c) => !c.hidden && !ALLOWED.some((a) => a.file === c.file && squash(c.text).includes(a.match)))
    expect(bare.map((c) => `${c.file}:${c.line} ${c.fn}: ${squash(c.text).slice(0, 140)}`)).toEqual([])
  })

  it('keeps no stale allowlist entry', () => {
    const stale = ALLOWED.filter((a) => !found.some((c) => !c.hidden && c.file === a.file && squash(c.text).includes(a.match)))
    expect(stale).toEqual([])
  })
})

describe('findChildCalls', () => {
  it('sees named, aliased, promisified, namespace and required starters, and whether each hides', () => {
    const src = [
      "import { spawn, execFile as ef, type ChildProcess } from 'node:child_process'",
      "import * as cp from 'child_process'",
      "import { promisify } from 'node:util'",
      'const efp = promisify(ef)',
      "const { execSync } = require('node:child_process')",
      "spawn('git', ['status'], { windowsHide: true })",
      "ef('git', [], (e) => e)",
      "await efp('git', ['log'], {\n  timeout: 5,\n  windowsHide: true\n})",
      "cp.spawnSync('where', ['git'])",
      "execSync('ver')",
      "cp.fork('m.js', { windowsHide: true })"
    ].join('\n')
    expect(findChildCalls(src).map((c) => [c.fn, c.hidden])).toEqual([
      ['spawn', true],
      ['execFile', false],
      ['execFile', true],
      ['spawnSync', false],
      ['execSync', false],
      ['fork', true]
    ])
  })

  it('ignores calls in comments and strings, member calls of other objects, and declarations', () => {
    const src = [
      "import { spawn } from 'node:child_process'",
      '// spawn(\'git\') in prose',
      "const script = `cp.spawn(orig, { shell: true })`",
      "const s = 'spawn(x)'",
      'pty.spawn(file, args, {})',
      'function spawn2() {}',
      'export function spawnLike(a: typeof spawn) {}'
    ].join('\n')
    expect(findChildCalls(src)).toEqual([])
  })

  it('does not take windowsHide named only in a comment inside the call', () => {
    const src = "import { spawn } from 'node:child_process'\nspawn('git', [], { /* windowsHide */ stdio: 'ignore' })"
    expect(findChildCalls(src).map((c) => c.hidden)).toEqual([false])
  })

  it('keeps template expressions as code', () => {
    const src = "import { execFile } from 'node:child_process'\nconst t = `${execFile('git', [])}`"
    expect(findChildCalls(src).map((c) => [c.fn, c.hidden, c.line])).toEqual([['execFile', false, 2]])
  })

  it('leaves type-only imports alone', () => {
    const src = "import type { SpawnOptions } from 'node:child_process'\nimport type cp from 'node:child_process'\ncp.spawn('x')"
    expect(findChildCalls(src)).toEqual([])
  })
})
