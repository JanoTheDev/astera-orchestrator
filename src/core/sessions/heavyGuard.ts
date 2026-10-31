// A worker's test, typecheck and build runs take a heavy slot (owner spec 2026-10-31). Ten parallel typechecks or
// vitest runs are what exhausts memory, and only N heavy commands may run at once on this machine (`astera heavy`,
// heavyLock.ts). The brief tells a worker to run them through `astera heavy`; this enforces it: a PreToolUse hook on
// Bash and PowerShell (statusline.ts ensureFiles) rewrites the command so every heavy segment starts with
// `astera heavy --`.
//
// **The rewrite is in place, per segment.** `cd x && npx vitest run a.test.ts` becomes
// `cd x && astera heavy -- npx vitest run a.test.ts`: `astera heavy` takes the command word and its arguments as the
// shell already parsed them (no `-c '<line>'` string to quote for Bash and again for PowerShell, and `cd` / `git` /
// `echo` segments of the line do not hold a slot). A segment already under `astera heavy` is left alone.
//
// **Transparent rewrite, not a refusal.** Claude Code 2.1.316's PreToolUse output takes `updatedInput` (checked in the
// installed binary: it is applied with or without a `permissionDecision`), so the worker's call runs as the rewritten
// command and the permission flow is unchanged. No `permissionDecision` is sent, so the hook neither approves nor
// refuses anything.
//
// **Only a worker is rewritten**, decided as deliveryGuard.ts does it: orchestration.json beside the script (the
// profile dir) says whether this session (`ASTERA_SESSION`) holds an open Dispatch (`holdsOpenDispatch`, ADR-004). A
// coordinator, a planner and the owner's own tabs run their tests as before.
//
// **The hook runs only for a matching command**: the handlers carry Claude Code's `if` filter (permission rule syntax),
// so an ordinary Bash or PowerShell call spawns no node.
//
// shortcut: a Codex worker gets no Claude hooks, so it is not rewritten here; its guard is the brief
// (WORKER_MACHINE_RULES names test, typecheck and build runs as heavy jobs).
// shortcut: unreadable state lets the call through unchanged, as deliveryGuard.ts does: a broken guard must not stop a tab.
// shortcut: a heavy command inside `bash -c '…'`, `cmd /c …` or `powershell -Command '…'` is not looked into, and a command
// after a here-document's body is not rewritten; the brief is the guard for those.
import { holdsOpenDispatch } from './deliveryGuard'

/** The words that can make a line a heavy command, as `if` filter bodies (`Bash(<body>)` / `PowerShell(<body>)`):
 *  a line without any of them spawns no node. Wide on purpose; `heavyRewrite` is what decides. */
export const HEAVY_GUARD_IF_BODIES = [
  '*vitest*',
  '*jest*',
  '*tsc*',
  '*turbo*',
  '*electron-vite*',
  '*npm t*',
  '*npm run*',
  '*npm rum*',
  '*npm exec*',
  '*pnpm*',
  '*yarn*',
  '*bun test*',
  '*bun run*',
  '*bun x*',
  '*bunx*',
  '*biome*',
  '*eslint*',
  '*bun lint*'
] as const

/** The hook's handlers: one per tool and filter. */
export const HEAVY_GUARD_IFS = {
  Bash: HEAVY_GUARD_IF_BODIES.map((b) => `Bash(${b})`),
  PowerShell: HEAVY_GUARD_IF_BODIES.map((b) => `PowerShell(${b})`)
} as const

/**
 * The command with `launcher` (`astera heavy --`) put in front of every test / typecheck / build command in it, or
 * null when it has none (or when it is not a worker's). `shell` is `'powershell'` for the PowerShell tool, anything
 * else is Bash. Self-contained on purpose (no module constants, no helper outside): its source runs inside the script.
 */
export function heavyRewrite(command: unknown, isWorker: boolean, shell?: string, launcher?: string): string | null {
  if (!isWorker || typeof command !== 'string' || command === '') return null
  const ps = shell === 'powershell'
  const launch = launcher || 'astera heavy --'
  const src: string = command
  const n = src.length

  // ---- 1. split into shell segments (quotes, comments, here-documents are skipped over) ----
  const segs: number[][] = []
  let segStart = 0
  let skip: { at: number; to: number } | null = null
  let quote = ''
  let i = 0
  function cut(end: number, next: number): void {
    segs.push([segStart, end])
    segStart = next
    i = next
  }
  while (i < n) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (quote === '"' && c === (ps ? '`' : '\\')) i++
      i++
      continue
    }
    if (c === '\n' && skip !== null && i >= skip.at) {
      const to = skip.to
      skip = null
      cut(i, to)
      continue
    }
    if (c === "'" || c === '"') {
      // a PowerShell here-string `@'` / `@"` at a line end: its body is text, up to the closing line
      if (ps && src[i - 1] === '@' && /^[ \t]*\r?\n/.test(src.slice(i + 1))) {
        const close = src.indexOf('\n' + c + '@', i + 1)
        i = close === -1 ? n : close + 3
        continue
      }
      quote = c
      i++
      continue
    }
    if (c === (ps ? '`' : '\\')) {
      i += 2
      continue
    }
    if (c === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      const nl = src.indexOf('\n', i)
      segs.push([segStart, i])
      segStart = nl === -1 ? n : nl
      i = segStart
      continue
    }
    if (!ps && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      // a here-document: its body is text, from the next line to the line that is the delimiter
      const m = /^<<-?[ \t]*(?:"([^"]*)"|'([^']*)'|\\?([^\s;&|()<>]+))/.exec(src.slice(i))
      if (m) {
        const delim = m[1] ?? m[2] ?? m[3]
        const nl = src.indexOf('\n', i)
        if (nl !== -1) {
          let p = nl + 1
          let to = n
          while (p <= n) {
            let e = src.indexOf('\n', p)
            if (e === -1) e = n
            if (src.slice(p, e).trim() === delim) {
              to = e
              break
            }
            p = e + 1
          }
          skip = { at: nl, to }
        }
        i += m[0].length
        continue
      }
    }
    const two = src.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      cut(i, i + 2)
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '(' || (c === '{' && src[i - 1] !== '$' && /^\s/.test(src.slice(i + 1, i + 2) || ' '))) {
      cut(i, i + 1)
      continue
    }
    // Bash's `&` runs in the background (a separator); in `2>&1`, `&>` and `|&` it belongs to the redirection
    if (c === '&' && !ps && src[i - 1] !== '>' && src[i - 1] !== '<' && src[i - 1] !== '|' && src[i + 1] !== '>') {
      cut(i, i + 1)
      continue
    }
    i++
  }
  segs.push([segStart, n])

  // ---- 2. per segment: the first word that is the command, and whether it is a heavy one ----
  type Tok = { t: string; s: number; e: number }
  function tokens(from: number, to: number): Tok[] {
    const out: Tok[] = []
    let q = ''
    let start = -1
    for (let k = from; k < to; k++) {
      const ch = src[k]
      if (q) {
        if (ch === q) q = ''
        else if (q === '"' && ch === (ps ? '`' : '\\')) k++
        continue
      }
      if (/\s/.test(ch)) {
        if (start !== -1) out.push({ t: src.slice(start, k), s: start, e: k })
        start = -1
        continue
      }
      if (start === -1) start = k
      if (ch === "'" || ch === '"') q = ch
      else if (ch === (ps ? '`' : '\\')) k++
    }
    if (start !== -1) out.push({ t: src.slice(start, to), s: start, e: to })
    return out
  }
  /** A token as a program name: no quotes, no folder (`/` or `\`), no extension, lower case. */
  function word(t: string): string {
    const bare = t.replace(/["']/g, '').replace(/[)};]+$/, '')
    const base = bare.slice(Math.max(bare.lastIndexOf('/'), bare.lastIndexOf('\\')) + 1).toLowerCase()
    return base.replace(/\.(cmd|exe|ps1|bat|js|mjs|cjs)$/, '')
  }
  function plain(t: string): string {
    return t.replace(/["']/g, '').replace(/[)};]+$/, '')
  }
  // lint and format:check are heavy too: biome peaked at 18.6 GB in the 25-agent memory measurement
  const SCRIPT = /^(test|typecheck|type-check|build|dist|lint|format:check)/
  const VALUE_FLAGS = ['--prefix', '--cwd', '-C', '--dir', '--workspace', '--filter', '-F']
  /** The index of the first token from `k` that is not a flag (a flag's own value is skipped too), or -1. */
  function nonFlag(toks: Tok[], k: number): number {
    for (; k < toks.length; k++) {
      const t = plain(toks[k].t)
      if (t === '--') continue
      if (t.startsWith('-')) {
        if (VALUE_FLAGS.includes(t)) k++
        continue
      }
      return k
    }
    return -1
  }
  function versionOnly(toks: Tok[], k: number): boolean {
    return k < toks.length && /^(-v|-V|--version|-h|--help)$/.test(plain(toks[k].t))
  }
  /** Whether the command that starts at token `k` is a test, typecheck or build run. */
  function heavy(toks: Tok[], k: number, depth: number): boolean {
    if (k < 0 || k >= toks.length || depth > 4) return false
    const w = word(toks[k].t)
    if (w === 'vitest' || w === 'jest' || w === 'tsc' || w === 'vue-tsc' || w === 'biome' || w === 'eslint') return !versionOnly(toks, k + 1)
    if (w === 'electron-vite') {
      const a = nonFlag(toks, k + 1)
      return a !== -1 && plain(toks[a].t) === 'build'
    }
    if (w === 'npx' || w === 'bunx' || w === 'pnpx') return heavy(toks, nonFlag(toks, k + 1), depth + 1)
    if (w === 'node') return heavy(toks, nonFlag(toks, k + 1), depth + 1) // `node node_modules/vitest/vitest.mjs run`
    if (w === 'turbo') {
      const a = nonFlag(toks, k + 1)
      return a !== -1 && /^(run|typecheck|test|build)$/.test(plain(toks[a].t))
    }
    if (w === 'npm' || w === 'pnpm' || w === 'yarn' || w === 'bun') {
      const a = nonFlag(toks, k + 1)
      if (a === -1) return false
      const sub = plain(toks[a].t)
      if (sub === 'test' || (w === 'npm' && (sub === 't' || sub === 'tst'))) return true
      if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
        const s = nonFlag(toks, a + 1)
        if (s === -1) return false
        return SCRIPT.test(plain(toks[s].t)) || (w !== 'npm' && heavy(toks, s, depth + 1))
      }
      if (sub === 'exec' || sub === 'dlx' || sub === 'x') return heavy(toks, nonFlag(toks, a + 1), depth + 1)
      if (w !== 'npm' && SCRIPT.test(sub)) return true // `pnpm typecheck`, `yarn build`, `bun typecheck`
      return w !== 'npm' && w !== 'bun' && heavy(toks, a, depth + 1) // `yarn vitest`, `pnpm tsc`
    }
    return false
  }

  const PREFIX = ['time', 'command', 'exec', 'nohup', 'call', 'sudo', 'env', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!']
  const edits: { at: number; to: number }[] = []
  for (let g = 0; g < segs.length; g++) {
    const toks = tokens(segs[g][0], segs[g][1])
    let k = 0
    let amp = -1
    while (k < toks.length) {
      const t = toks[k].t
      if (/^[A-Za-z_]\w*=/.test(t) || /^\$env:\w+=/i.test(t)) k++
      else if (t === '&' && ps) {
        amp = k
        k++
      } else if (PREFIX.includes(t)) k++
      else if (t === 'nice') {
        k++
        while (k < toks.length && toks[k].t.startsWith('-')) k += toks[k].t === '-n' ? 2 : 1
      } else if (t === 'timeout') {
        k++
        while (k < toks.length && toks[k].t.startsWith('-')) k++
        if (k < toks.length && /^\d/.test(toks[k].t)) k++
      } else break
    }
    if (k >= toks.length || !heavy(toks, k, 0)) continue
    // `& npx vitest` (PowerShell's call operator) has its `&` replaced by the launcher, which is one command already
    if (amp !== -1 && amp === k - 1) edits.push({ at: toks[amp].s, to: toks[amp].e })
    else edits.push({ at: toks[k].s, to: toks[k].s })
  }
  if (edits.length === 0) return null

  let out = ''
  let pos = 0
  for (let e = 0; e < edits.length; e++) {
    const ed = edits[e]
    const replaced = ed.to > ed.at
    out += src.slice(pos, ed.at) + launch + (replaced ? '' : ' ')
    pos = ed.to
  }
  return out + src.slice(pos)
}

/** The hook command (node): reads the PreToolUse payload on stdin and, for a worker's heavy command, prints the hook
 *  JSON whose `updatedInput` is the same call with the command run under `astera heavy`. Any failure lets the call
 *  through unchanged. */
export const HEAVY_GUARD_SCRIPT = `const fs = require('fs')
const path = require('path')
const rewrite = ${heavyRewrite.toString()}
const holds = ${holdsOpenDispatch.toString()}
const chunks = []
function launcher(ps) {
  // what the worker brief assumes: \`astera\` on PATH, else the absolute path in ASTERA_CLI; neither: leave the command
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.ps1', '.bat'] : ['']
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue
    for (const x of exts) {
      try { if (fs.statSync(path.join(d, 'astera' + x)).isFile()) return 'astera heavy --' } catch {}
    }
  }
  if (process.env.ASTERA_CLI) return ps ? '& $env:ASTERA_CLI heavy --' : '"$ASTERA_CLI" heavy --'
  return ''
}
function finish() {
  let out = null
  try {
    const p = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const input = p && p.tool_input
    const command = input && input.command
    const shell = p && p.tool_name === 'PowerShell' ? 'powershell' : 'bash'
    if (rewrite(command, true, shell)) {
      let state = null
      try { state = JSON.parse(fs.readFileSync(path.join(__dirname, 'orchestration.json'), 'utf8')) } catch {}
      const launch = holds(state, process.env.ASTERA_SESSION) ? launcher(shell === 'powershell') : ''
      const next = launch ? rewrite(command, true, shell, launch) : null
      if (next) out = Object.assign({}, input, { command: next })
    }
  } catch {}
  if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: out } }))
  process.exit(0)
}
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', finish)
process.stdin.on('error', finish)
`
