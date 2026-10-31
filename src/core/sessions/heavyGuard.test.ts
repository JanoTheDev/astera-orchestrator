// A worker's test, typecheck and build runs go through `astera heavy`: the rewrite rule, and the hook script run as
// Claude Code runs it (a PreToolUse payload on stdin).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { HEAVY_GUARD_IFS, HEAVY_GUARD_SCRIPT, heavyRewrite } from './heavyGuard'

const H = 'astera heavy --'
const bash = (c: string): string | null => heavyRewrite(c, true, 'bash')
const pwsh = (c: string): string | null => heavyRewrite(c, true, 'powershell')

describe('heavyRewrite: what is a heavy command', () => {
  it('wraps the test runners, the typechecks and the builds', () => {
    const wrapped: [string, string][] = [
      ['npx vitest run --maxWorkers=2 a.test.ts', `${H} npx vitest run --maxWorkers=2 a.test.ts`],
      ['vitest run a.test.ts', `${H} vitest run a.test.ts`],
      ['npx --yes vitest run', `${H} npx --yes vitest run`],
      ['npm test', `${H} npm test`],
      ['npm t -- foo', `${H} npm t -- foo`],
      ['npm run test:unit -- foo', `${H} npm run test:unit -- foo`],
      ['npm run --silent test', `${H} npm run --silent test`],
      ['npm --prefix packages/x run test', `${H} npm --prefix packages/x run test`],
      ['npm run typecheck', `${H} npm run typecheck`],
      ['npm run build', `${H} npm run build`],
      ['npm run dist:linux', `${H} npm run dist:linux`],
      ['tsc -p tsconfig.json --noEmit', `${H} tsc -p tsconfig.json --noEmit`],
      ['npx tsc --noEmit', `${H} npx tsc --noEmit`],
      ['npx vue-tsc --noEmit -p tsconfig.web.json', `${H} npx vue-tsc --noEmit -p tsconfig.web.json`],
      ['jest --runInBand', `${H} jest --runInBand`],
      ['turbo run typecheck', `${H} turbo run typecheck`],
      ['npx turbo test', `${H} npx turbo test`],
      ['turbo build --filter=web', `${H} turbo build --filter=web`],
      ['bun test', `${H} bun test`],
      ['bun run typecheck', `${H} bun run typecheck`],
      ['bun run build', `${H} bun run build`],
      ['pnpm test', `${H} pnpm test`],
      ['pnpm -r typecheck', `${H} pnpm -r typecheck`],
      ['pnpm --filter web run build', `${H} pnpm --filter web run build`],
      ['yarn build', `${H} yarn build`],
      ['yarn test --watch=false', `${H} yarn test --watch=false`],
      ['yarn vitest run', `${H} yarn vitest run`],
      ['electron-vite build', `${H} electron-vite build`],
      ['npx electron-vite build', `${H} npx electron-vite build`],
      ['node node_modules/vitest/vitest.mjs run', `${H} node node_modules/vitest/vitest.mjs run`],
      ['biome check .', `${H} biome check .`],
      ['biome ci src', `${H} biome ci src`],
      ['biome format --write src', `${H} biome format --write src`],
      ['npx biome lint src', `${H} npx biome lint src`],
      ['bunx biome check', `${H} bunx biome check`],
      ['pnpm exec biome check', `${H} pnpm exec biome check`],
      ['eslint src', `${H} eslint src`],
      ['npx eslint . --max-warnings=0', `${H} npx eslint . --max-warnings=0`],
      ['bunx eslint src', `${H} bunx eslint src`],
      ['npm run lint', `${H} npm run lint`],
      ['npm run lint:fix', `${H} npm run lint:fix`],
      ['npm run format:check', `${H} npm run format:check`],
      ['pnpm lint', `${H} pnpm lint`],
      ['pnpm run lint', `${H} pnpm run lint`],
      ['yarn lint', `${H} yarn lint`],
      ['bun run lint', `${H} bun run lint`],
      ['bun lint', `${H} bun lint`]
    ]
    for (const [cmd, want] of wrapped) expect(bash(cmd), cmd).toBe(want)
  })

  it('leaves plain reads and everything else alone', () => {
    for (const cmd of [
      'git status',
      'git log --oneline -5',
      'ls -la',
      'astera sessions list --json',
      'npx vitest --version',
      'vitest --help',
      'tsc --version',
      'npx tsc -v',
      'npm install',
      'npm ci',
      'npm run dev',
      'npm run format',
      'npm view vitest version',
      'biome --version',
      'biome -v',
      'biome --help',
      'npx biome --version',
      'pnpm exec biome --help',
      'eslint --version',
      'npx eslint -v',
      'eslint-plugin-foo index.js',
      'pnpm install',
      'yarn add vitest',
      'electron-vite dev',
      'turbo --version',
      'node script.js',
      'echo "npm test"',
      "git commit -m 'run npx vitest run'",
      'grep -rn "tsc" src',
      'cat vitest.config.ts',
      ''
    ]) {
      expect(bash(cmd), cmd).toBeNull()
    }
    // the script rule is a prefix (spec: `test*`, `dist*`), so a script named test-something is wrapped too
    expect(bash('npm run test-helpers')).toBe(`${H} npm run test-helpers`)
  })

  it('wraps each heavy segment of a compound line and nothing else', () => {
    expect(bash('cd x && npx vitest run a.test.ts')).toBe(`cd x && ${H} npx vitest run a.test.ts`)
    expect(bash('cd x; npm run typecheck; echo done')).toBe(`cd x; ${H} npm run typecheck; echo done`)
    expect(bash('npm run typecheck && npx vitest run a.test.ts')).toBe(`${H} npm run typecheck && ${H} npx vitest run a.test.ts`)
    expect(bash('npx vitest run 2>&1 | tail -20')).toBe(`${H} npx vitest run 2>&1 | tail -20`)
    expect(bash('npx vitest run a.test.ts || echo failed')).toBe(`${H} npx vitest run a.test.ts || echo failed`)
    expect(bash('git status\nnpx vitest run a.test.ts\ngit diff')).toBe(`git status\n${H} npx vitest run a.test.ts\ngit diff`)
    expect(bash('(cd x && npx tsc --noEmit)')).toBe(`(cd x && ${H} npx tsc --noEmit)`)
    expect(bash('x=$(npx vitest list)')).toBe(`x=$(${H} npx vitest list)`)
    expect(bash('npm test &')).toBe(`${H} npm test &`)
    expect(bash('if npx tsc --noEmit; then echo ok; fi')).toBe(`if ${H} npx tsc --noEmit; then echo ok; fi`)
  })

  it('keeps env assignments and wrappers in front of the launcher position', () => {
    expect(bash('CI=1 npx vitest run')).toBe(`CI=1 ${H} npx vitest run`)
    expect(bash('NODE_ENV=test FOO="a b" npm test')).toBe(`NODE_ENV=test FOO="a b" ${H} npm test`)
    expect(bash('nice -n 10 npx vitest run')).toBe(`nice -n 10 ${H} npx vitest run`)
    expect(bash('time npm run typecheck')).toBe(`time ${H} npm run typecheck`)
    expect(bash('timeout 600 npm test')).toBe(`timeout 600 ${H} npm test`)
  })

  it('leaves a command that is already under astera heavy', () => {
    for (const cmd of [
      'astera heavy -- npx vitest run a.test.ts',
      'cd x && astera heavy -- npm run typecheck',
      '"$ASTERA_CLI" heavy -- npx vitest run',
      'astera heavy -- nice -n 10 npx vitest run --maxWorkers=2',
      'flock /tmp/astera-fullsuite.lock npx vitest run'
    ]) {
      expect(bash(cmd), cmd).toBeNull()
    }
    // one wrapped and one bare segment: only the bare one is touched
    expect(bash('astera heavy -- npm run typecheck && npx vitest run a.test.ts')).toBe(
      `astera heavy -- npm run typecheck && ${H} npx vitest run a.test.ts`
    )
    // and a rewrite is idempotent
    const once = bash('cd x && npx vitest run a.test.ts')!
    expect(bash(once)).toBeNull()
  })

  it('does not look inside quotes, comments or here-documents', () => {
    expect(bash(`git commit -m "fix: npm test && npx vitest run"`)).toBeNull()
    expect(bash(`echo 'a; npx vitest run'`)).toBeNull()
    expect(bash('echo hi # npm test')).toBeNull()
    expect(bash('npm test # then look')).toBe(`${H} npm test # then look`)
    expect(bash(`cat > note.md <<'EOF'\nrun:\nnpx vitest run a.test.ts\nnpm run typecheck\nEOF\ngit add note.md`)).toBeNull()
    expect(bash(`cat > note.md <<EOF\nnpm test\nEOF\nnpx vitest run a.test.ts`)).toBe(
      `cat > note.md <<EOF\nnpm test\nEOF\n${H} npx vitest run a.test.ts`
    )
    // `2>&1` and `&>` are not separators
    expect(bash('npx vitest run 2>&1')).toBe(`${H} npx vitest run 2>&1`)
    expect(bash('echo a &> out.txt')).toBeNull()
  })

  it('wraps lint and format runs inside a compound line, and only those segments', () => {
    expect(bash('cd x && npx biome check . && npm run lint')).toBe(`cd x && ${H} npx biome check . && ${H} npm run lint`)
    expect(bash('git add -A; eslint src; echo done')).toBe(`git add -A; ${H} eslint src; echo done`)
    expect(bash('biome check . | tail -20')).toBe(`${H} biome check . | tail -20`)
    expect(bash('npx biome check --write . || echo failed')).toBe(`${H} npx biome check --write . || echo failed`)
    // the word inside a quoted message is text
    expect(bash('git commit -m "run biome check first"')).toBeNull()
    expect(bash('echo "npm run lint"')).toBeNull()
  })
})

describe('heavyRewrite: Windows paths and PowerShell', () => {
  it('wraps a PowerShell line, with PowerShell quoting kept as typed', () => {
    expect(pwsh('npx vitest run a.test.ts')).toBe(`${H} npx vitest run a.test.ts`)
    expect(pwsh('cd C:\\dev\\x; npm run typecheck')).toBe(`cd C:\\dev\\x; ${H} npm run typecheck`)
    expect(pwsh('Set-Location "C:\\Users\\Jo Doe\\proj"; npx vitest run src\\core\\a.test.ts')).toBe(
      `Set-Location "C:\\Users\\Jo Doe\\proj"; ${H} npx vitest run src\\core\\a.test.ts`
    )
    expect(pwsh("npx vitest run -t 'it''s; fine' && npm test")).toBe(`${H} npx vitest run -t 'it''s; fine' && ${H} npm test`)
    expect(pwsh('if ($?) { npm run build }')).toBe(`if ($?) { ${H} npm run build }`)
    expect(pwsh('$env:CI = "1"; npx vitest run')).toBe(`$env:CI = "1"; ${H} npx vitest run`)
    expect(pwsh('$env:CI="1" npx vitest run')).toBe(`$env:CI="1" ${H} npx vitest run`)
    expect(pwsh('npx vitest run 2>&1 | Select-Object -Last 20')).toBe(`${H} npx vitest run 2>&1 | Select-Object -Last 20`)
    expect(pwsh('cd C:\\dev\\x; npx biome check .')).toBe(`cd C:\\dev\\x; ${H} npx biome check .`)
    expect(pwsh('npx eslint src; npm run lint')).toBe(`${H} npx eslint src; ${H} npm run lint`)
    expect(pwsh('& "C:\\dev\\x\\node_modules\\.bin\\biome.cmd" ci .')).toBe(`${H} "C:\\dev\\x\\node_modules\\.bin\\biome.cmd" ci .`)
    expect(pwsh('npx biome --version')).toBeNull()
    expect(pwsh('npx eslint --version')).toBeNull()
  })

  it("replaces PowerShell's call operator with a launcher that brings its own", () => {
    const L = '& $env:ASTERA_CLI heavy --'
    expect(heavyRewrite('& npx vitest run', true, 'powershell', L)).toBe(`${L} npx vitest run`)
    expect(heavyRewrite('npx vitest run; npm test', true, 'powershell', L)).toBe(`${L} npx vitest run; ${L} npm test`)
    expect(heavyRewrite('& "C:\\Program Files\\nodejs\\npm.cmd" test', true, 'powershell', L)).toBe(`${L} "C:\\Program Files\\nodejs\\npm.cmd" test`)
    expect(heavyRewrite('& astera heavy -- npm test', true, 'powershell', L)).toBeNull()
    expect(heavyRewrite('npm test', true, 'bash', '"$ASTERA_CLI" heavy --')).toBe('"$ASTERA_CLI" heavy -- npm test')
  })

  it('knows a tool by its name whatever the folder, the quotes or the extension', () => {
    expect(bash('C:\\dev\\x\\node_modules\\.bin\\vitest.cmd run')).toBe(`${H} C:\\dev\\x\\node_modules\\.bin\\vitest.cmd run`)
    expect(pwsh('& "C:\\dev\\my proj\\node_modules\\.bin\\tsc.cmd" --noEmit')).toBe(
      `${H} "C:\\dev\\my proj\\node_modules\\.bin\\tsc.cmd" --noEmit`
    )
    expect(pwsh('.\\node_modules\\.bin\\vitest run')).toBe(`${H} .\\node_modules\\.bin\\vitest run`)
    expect(bash('./node_modules/.bin/vitest run')).toBe(`${H} ./node_modules/.bin/vitest run`)
    expect(bash('"C:/Program Files/nodejs/npm.cmd" test')).toBe(`${H} "C:/Program Files/nodejs/npm.cmd" test`)
    expect(bash('cd "C:\\Users\\Jo Doe\\p" && npm run typecheck')).toBe(`cd "C:\\Users\\Jo Doe\\p" && ${H} npm run typecheck`)
    expect(bash('node C:\\dev\\x\\node_modules\\vitest\\vitest.mjs run')).toBe(`${H} node C:\\dev\\x\\node_modules\\vitest\\vitest.mjs run`)
    expect(bash('type C:\\dev\\x\\vitest.config.ts')).toBeNull()
  })

  it('here-strings in PowerShell are text', () => {
    expect(pwsh("@'\nnpm test\n'@ | Set-Content note.md\nnpx vitest run")).toBe(`@'\nnpm test\n'@ | Set-Content note.md\n${H} npx vitest run`)
  })
})

describe('heavyRewrite: only a worker', () => {
  it('leaves a non-worker and a non-string alone', () => {
    expect(heavyRewrite('npx vitest run', false, 'bash')).toBeNull()
    expect(heavyRewrite(undefined, true, 'bash')).toBeNull()
    expect(heavyRewrite(42, true, 'bash')).toBeNull()
  })
})

describe('the hook filters', () => {
  it('has one handler filter per word, for each tool', () => {
    expect(HEAVY_GUARD_IFS.Bash).toContain('Bash(*vitest*)')
    expect(HEAVY_GUARD_IFS.PowerShell).toContain('PowerShell(*vitest*)')
    expect(HEAVY_GUARD_IFS.Bash.length).toBe(HEAVY_GUARD_IFS.PowerShell.length)
    for (const f of HEAVY_GUARD_IFS.Bash) expect(f).toMatch(/^Bash\(\*.+\*\)$/)
  })
  it('every command the rule wraps matches a filter, so the hook is spawned for it', () => {
    const globs = HEAVY_GUARD_IFS.Bash.map((f) => new RegExp('^' + f.slice(5, -1).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'))
    for (const cmd of [
      'npx vitest run a.test.ts',
      'cd x && npm test',
      'npm t',
      'npm run typecheck',
      'tsc --noEmit',
      'turbo build',
      'bun test',
      'bun run build',
      'pnpm test',
      'yarn build',
      'electron-vite build',
      'jest',
      'npm exec vitest',
      'biome check .',
      'npx biome lint src',
      'eslint src',
      'npm run lint',
      'pnpm lint',
      'yarn lint',
      'bun run lint',
      'bun lint',
      'npm run format:check'
    ]) {
      expect(bash(cmd), cmd).not.toBeNull()
      expect(globs.some((g) => g.test(cmd)), cmd).toBe(true)
    }
  })
})

// the process env without any spelling of PATH (Windows has `Path`), so the one a test sets is the only one
const baseEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !/^path$/i.test(k) && v !== undefined)) as Record<string, string>

describe('the hook script, run as Claude Code runs it', () => {
  let dir: string, script: string, binDir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-heavy-guard-'))
    script = path.join(dir, 'astera-heavy-guard.cjs')
    await fs.writeFile(script, HEAVY_GUARD_SCRIPT)
    // ses_worker holds an open Dispatch; ses_done's is closed; the coordinator holds none
    await fs.writeFile(
      path.join(dir, 'orchestration.json'),
      JSON.stringify({ dispatches: [{ sessionId: 'ses_worker' }, { sessionId: 'ses_done', endedAt: '2026-10-18T00:00:00Z' }] })
    )
    // a folder with an `astera` in it, to stand for the worker's PATH
    binDir = path.join(dir, 'bin')
    await fs.mkdir(binDir)
    await fs.writeFile(path.join(binDir, process.platform === 'win32' ? 'astera.cmd' : 'astera'), '')
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })
  const run = (session: string, command: string, opts: { tool?: string; env?: Record<string, string> } = {}): string => {
    const env: Record<string, string> = { ...baseEnv(), ASTERA_SESSION: session, ASTERA_CLI: '', PATH: binDir, ...opts.env } // `astera` is on PATH; node is run by its absolute path
    return spawnSync(process.execPath, [script], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: opts.tool ?? 'Bash', tool_input: { command, description: 'd', timeout: 5000 } }),
      env,
      encoding: 'utf8'
    }).stdout
  }

  it("rewrites a worker's heavy command through updatedInput and keeps the rest of the call", () => {
    const out = JSON.parse(run('ses_worker', 'cd x && npx vitest run a.test.ts'))
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(out.hookSpecificOutput.updatedInput).toEqual({
      command: `cd x && ${H} npx vitest run a.test.ts`,
      description: 'd',
      timeout: 5000
    })
    // it neither approves nor refuses: the permission flow is Claude Code's
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined()
  })

  it('rewrites a PowerShell call, with Windows paths and spaces', () => {
    const cmd = 'cd "C:\\Users\\Jo Doe\\proj"; npm run typecheck'
    const out = JSON.parse(run('ses_worker', cmd, { tool: 'PowerShell' }))
    expect(out.hookSpecificOutput.updatedInput.command).toBe(`cd "C:\\Users\\Jo Doe\\proj"; ${H} npm run typecheck`)
  })

  it('leaves a coordinator, a closed worker, a non-worker, a wrapped and an ordinary command alone', () => {
    expect(run('ses_coord', 'npx vitest run a.test.ts')).toBe('')
    expect(run('ses_done', 'npm run typecheck')).toBe('')
    expect(run('', 'npm run typecheck')).toBe('')
    expect(run('ses_worker', 'astera heavy -- npx vitest run a.test.ts')).toBe('')
    expect(run('ses_worker', 'git commit -m "npm test"')).toBe('')
    expect(run('ses_worker', 'npx vitest --version')).toBe('')
  })

  it('falls back to ASTERA_CLI when astera is not on PATH, and leaves the command when neither exists', () => {
    const cli = 'C:\\Users\\Jo Doe\\astera\\orch\\astera.cmd'
    const none = path.join(dir, 'empty')
    const viaCli = JSON.parse(run('ses_worker', 'npm test', { env: { PATH: none, ASTERA_CLI: cli } }))
    expect(viaCli.hookSpecificOutput.updatedInput.command).toBe('"$ASTERA_CLI" heavy -- npm test')
    const viaCliPs = JSON.parse(run('ses_worker', 'npm test', { tool: 'PowerShell', env: { PATH: none, ASTERA_CLI: cli } }))
    expect(viaCliPs.hookSpecificOutput.updatedInput.command).toBe('& $env:ASTERA_CLI heavy -- npm test')
    expect(run('ses_worker', 'npm test', { env: { PATH: none, ASTERA_CLI: '' } })).toBe('')
  })

  it('lets the call through when its state or payload is unreadable', async () => {
    const lone = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-heavy-guard-lone-'))
    try {
      const s = path.join(lone, 'g.cjs')
      await fs.writeFile(s, HEAVY_GUARD_SCRIPT) // no orchestration.json beside it
      const env = { ...baseEnv(), ASTERA_SESSION: 'ses_worker', PATH: binDir }
      const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
      expect(spawnSync(process.execPath, [s], { input: payload, env, encoding: 'utf8' }).stdout).toBe('')
      expect(spawnSync(process.execPath, [script], { input: 'not json', env, encoding: 'utf8' }).stdout).toBe('')
      expect(spawnSync(process.execPath, [script], { input: '{}', env, encoding: 'utf8' }).stdout).toBe('')
    } finally {
      await fs.rm(lone, { recursive: true, force: true })
    }
  })
})
