import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { SESSION_CONTEXT_SCRIPT, QUICKREF_FILE, codexDeveloperInstructions, sessionContextLines } from './sessionContext'
import { LAUNCH_FORBIDDEN } from './commands'
import { OWNER_HEADING } from '../prompts/ownerInstructions'
import { coordinatorBriefName } from '../orchestration/exec/specFiles'
import { plannerBriefName } from '../orchestration/exec/plannerStart'

describe('SessionStart context script', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-ctx-'))
    await fs.writeFile(path.join(dir, 'script.cjs'), SESSION_CONTEXT_SCRIPT, 'utf8')
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  async function run(settings: unknown | null, env: Record<string, string> = { ASTERA_CLI: 'x' }, hf?: unknown) {
    if (settings !== null) await fs.writeFile(path.join(dir, 'app-settings.json'), JSON.stringify(settings))
    if (hf) {
      await fs.mkdir(path.join(dir, 'higgsfield'), { recursive: true })
      await fs.writeFile(path.join(dir, 'higgsfield', 'accounts.json'), JSON.stringify(hf))
    }
    const r = spawnSync(process.execPath, [path.join(dir, 'script.cjs')], {
      input: '{}', encoding: 'utf8', env: { ...process.env, ASTERA_CLI: '', ASTERA_PROFILE_DIR: dir, ...env }
    })
    expect(r.stderr).toBe(''); expect(r.status).toBe(0)
    if (r.stdout.trim() === '') return null
    const j = JSON.parse(r.stdout)
    expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart')
    return j.hookSpecificOutput.additionalContext as string
  }

  it('prints valid hook JSON, always naming orchestration and the full list', async () => {
    const t = await run({})
    expect(t).toContain('This session runs inside Astera')
    expect(t).toContain('`astera help`')
    expect(t!.split('\n').length).toBeLessThanOrEqual(12)
  })

  it('drops the line of every feature that is off', async () => {
    const off = (await run({}))!
    expect(off).not.toContain('astera app js')
    expect(off).not.toContain('astera browser help')
    expect(off).not.toContain('/astera-task')
    expect(off).not.toContain('astera handoff')
    expect(off).not.toContain('higgsfield')
  })

  it('adds the lines of the features that are on', async () => {
    const on = (await run(
      { agentAppEnabled: true, agentBrowserEnabled: true, workUnitTrackingEnabled: true, resumeStrategy: 'smart' },
      { ASTERA_CLI: 'x' },
      { accounts: [{ id: 'a', label: 'A' }], current: 'a' }
    ))!
    expect(on).toContain('astera app js')
    expect(on).toContain('Never launch the app on the person')
    expect(on).toContain('astera browser help')
    expect(on).toContain('/astera-task')
    expect(on).toContain('astera handoff')
    expect(on).toContain('astera higgsfield list')
  })

  it('a missing or unreadable settings file reads as everything off, not as a failure', async () => {
    expect(await run(null)).toContain('inside Astera')
    await fs.writeFile(path.join(dir, 'app-settings.json'), '{not json')
    expect(await run(null)).not.toContain('astera app js')
  })

  describe('the quick reference', () => {
    const QR = 'Astera quick reference.\n```\nastera sessions list --json\n```'
    const withSkills = async (text: string | null) => {
      const skills = path.join(dir, 'skills')
      await fs.mkdir(skills, { recursive: true })
      if (text !== null) await fs.writeFile(path.join(skills, QUICKREF_FILE), text)
      return { ASTERA_CLI: 'x', ASTERA_SKILLS: skills }
    }

    it('is carried before the footer, which points at --brief and a section', async () => {
      const t = (await run({}, await withSkills(QR)))!
      expect(t).toContain(QR)
      expect(t.indexOf(QR)).toBeLessThan(t.indexOf('Full list:'))
      expect(t).toContain('`astera help --brief`')
      expect(t).toContain('`astera help <N>`')
    })
    it('falls back to the pointer line when the file or the folder is missing', async () => {
      const plain = sessionContextLines({}, null).join('\n')
      expect(await run({}, await withSkills(null))).toBe(plain)
      expect(await run({}, { ASTERA_CLI: 'x' })).toBe(plain)
      expect(plain).toContain('`astera help`')
    })
    it('is the same text sessionContextLines gives codex', async () => {
      expect(await run({ agentAppEnabled: true }, await withSkills(QR + '\n'))).toBe(
        sessionContextLines({ agentAppEnabled: true }, null, QR).join('\n')
      )
    })
    it('the shipped file is carried whole', async () => {
      const shipped = readFileSync(path.join(__dirname, '../../../resources/skills', QUICKREF_FILE), 'utf8')
      const t = (await run({}, { ASTERA_CLI: 'x', ASTERA_SKILLS: path.join(__dirname, '../../../resources/skills') }))!
      expect(t).toContain(shipped.trim())
    })
  })

  describe('the owner\'s session instructions', () => {
    const own = async (text: string | null) => {
      await fs.mkdir(path.join(dir, 'prompts'), { recursive: true })
      if (text !== null) await fs.writeFile(path.join(dir, 'prompts', 'session.md'), text)
    }
    it('end the context under the owner heading, the same text sessionContextLines gives codex', async () => {
      await own('Answer in French.\n')
      const t = (await run({}))!
      expect(t.endsWith(`${OWNER_HEADING}:\nAnswer in French.`)).toBe(true)
      expect(t).toBe(sessionContextLines({}, null, null, 'Answer in French.\n').join('\n'))
    })
    it('add nothing when the file is missing or blank', async () => {
      const plain = sessionContextLines({}, null).join('\n')
      await own(null)
      expect(await run({})).toBe(plain)
      await own('  \n')
      expect(await run({})).toBe(plain)
    })
  })

  it('prints nothing outside a session Astera started (no ASTERA_CLI)', async () => {
    expect(await run({ agentAppEnabled: true }, {})).toBeNull()
  })

  describe('re-pointing at the plan on compact and resume', () => {
    const SPEC = () => path.join(dir, 'spec.md')
    async function plan(source: string | null, state: unknown, files: string[] = ['spec.md', 'orch/specs/coordinator-run_1.md', 'orch/specs/planner-job_1.md']) {
      await fs.mkdir(path.join(dir, 'orch', 'specs'), { recursive: true })
      for (const f of files) await fs.writeFile(path.join(dir, f), 'x')
      await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state))
      const input = source === null ? 'not json' : JSON.stringify({ source })
      const r = spawnSync(process.execPath, [path.join(dir, 'script.cjs')], {
        input, encoding: 'utf8', env: { ...process.env, ASTERA_CLI: 'x', ASTERA_PROFILE_DIR: dir, ASTERA_SESSION: 's1' }
      })
      expect(r.stderr).toBe(''); expect(r.status).toBe(0)
      return JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string
    }
    const plain = sessionContextLines({}, null).join('\n')
    const disp = (o: object) => ({ dispatches: [{ sessionId: 's1', startedAt: '2026-01-01', specPath: SPEC(), ...o }] })

    it('names the worker spec on compact, preferring an open dispatch', async () => {
      const old = path.join(dir, 'old.md')
      const t = await plan('compact', { dispatches: [
        { sessionId: 's1', startedAt: '2026-02-01', endedAt: 'x', specPath: old }, { sessionId: 's1', startedAt: '2026-01-01', specPath: SPEC() }] },
        ['spec.md', 'old.md'])
      expect(t).toContain(`Your plan for this Astera session is ${SPEC()}.`)
    })
    it('names the coordinator and planner briefs on resume', async () => {
      const c = path.join(dir, 'orch', 'specs', coordinatorBriefName('run_1'))
      expect(await plan('resume', { runs: [{ id: 'run_1', coordinatorSessionId: 's1' }] })).toContain(`is ${c}.`)
      const p = path.join(dir, 'orch', 'specs', plannerBriefName('job_1'))
      expect(await plan('resume', { jobs: [{ id: 'job_1', plannerSessionIds: ['x', 's1'] }] })).toContain(`is ${p}.`)
    })
    it('adds nothing when the file is missing, on startup, or on garbage stdin', async () => {
      expect(await plan('compact', disp({}), [])).toBe(plain)
      expect(await plan('startup', disp({}))).toBe(plain)
      expect(await plan(null, disp({}))).toBe(plain)
    })
  })

  // The codex side decides its lines in TypeScript; the hook script decides them in its own copy. This
  // runs both over the same settings so the two cannot drift.
  it('decides the same lines as sessionContextLines', async () => {
    const hf = { accounts: [{ id: 'a', label: 'A' }], current: 'a' }
    const cases: Array<[unknown, unknown]> = [
      [{}, undefined],
      [{ agentAppEnabled: true }, undefined],
      [{ agentBrowserEnabled: true, workUnitTrackingEnabled: true }, hf],
      [{ agentAppEnabled: true, agentBrowserEnabled: true, workUnitTrackingEnabled: true, resumeStrategy: 'smart' }, hf]
    ]
    for (const [s, h] of cases) {
      await fs.rm(path.join(dir, 'higgsfield'), { recursive: true, force: true })
      expect(await run(s, { ASTERA_CLI: 'x' }, h)).toBe(sessionContextLines(s, h ?? null).join('\n'))
    }
  })
})

describe('codexDeveloperInstructions', () => {
  const ALL_ON = { agentAppEnabled: true, agentBrowserEnabled: true, workUnitTrackingEnabled: true, resumeStrategy: 'smart' }
  const HF = { accounts: [{ id: 'a', label: 'A' }], current: 'a' }
  function files(o: { settings?: unknown; hf?: unknown; codexConfig?: string }) {
    const map = new Map<string, string>()
    if (o.settings !== undefined) map.set(path.join('P', 'app-settings.json'), JSON.stringify(o.settings))
    if (o.hf !== undefined) map.set(path.join('P', 'higgsfield', 'accounts.json'), JSON.stringify(o.hf))
    if (o.codexConfig !== undefined) map.set(path.join('C', 'config.toml'), o.codexConfig)
    return (p: string): string | null => map.get(p) ?? null
  }
  const brief = (o: Parameters<typeof files>[0]) => codexDeveloperInstructions({ profileDir: 'P', codexHome: 'C', read: files(o) })

  it('tells a codex session what the hook tells a Claude one, on one line', () => {
    const t = brief({ settings: ALL_ON, hf: HF })!
    expect(t).not.toContain('\n')
    expect(t.startsWith('This session runs inside Astera.')).toBe(true)
    for (const s of ['astera app js', 'astera browser help', '/astera-task', 'astera handoff', 'astera higgsfield list', 'Full list'])
      expect(t).toContain(s)
  })

  // An npm-installed codex starts through `cmd.exe /c call`, which reads these as syntax.
  it('carries nothing cmd.exe would read as syntax, with every feature on', () => {
    expect(LAUNCH_FORBIDDEN.test(brief({ settings: ALL_ON, hf: HF })!)).toBe(false)
  })

  describe('the quick reference', () => {
    const QR_PATH = path.join('S', QUICKREF_FILE)
    const withQr = (text: string) => {
      const base = files({ settings: {} })
      return (p: string): string | null => (p === QR_PATH ? text : base(p))
    }
    const codex = (read: (p: string) => string | null) =>
      codexDeveloperInstructions({ profileDir: 'P', codexHome: 'C', skillsDir: 'S', read })

    it('is carried on the one line, line breaks as spaces and angle brackets as parentheses', () => {
      const t = codex(withQr('Quick.\n```\nastera help <N>\n```'))!
      expect(t).not.toContain('\n')
      expect(t).toContain('Quick. ``` astera help (N) ```')
    })
    it('the shipped file passes the cmd.exe check', () => {
      const shipped = readFileSync(path.join(__dirname, '../../../resources/skills', QUICKREF_FILE), 'utf8')
      const t = codex(withQr(shipped))!
      expect(t).toContain('astera sessions list --json')
      expect(LAUNCH_FORBIDDEN.test(t)).toBe(false)
    })
    it('drops only the quick reference when it holds cmd.exe syntax', () => {
      const t = codex(withQr('run a | b'))!
      expect(t).not.toContain('a | b')
      expect(t).toContain('astera help')
    })
    it('is left out when the file is missing', () => {
      expect(codex(files({ settings: {} }))).toBe(brief({ settings: {} }))
    })
  })

  describe('the owner\'s session instructions', () => {
    const OWN = path.join('P', 'prompts', 'session.md')
    const withOwn = (text: string) => {
      const base = files({ settings: {} })
      return (p: string): string | null => (p === OWN ? text : base(p))
    }
    const codex = (read: (p: string) => string | null) => codexDeveloperInstructions({ profileDir: 'P', codexHome: 'C', read })
    it('end the one line under the owner heading', () => {
      expect(codex(withOwn('Be brief.\nNo emoji.'))!.endsWith(`${OWNER_HEADING.replace('>', ')')}: Be brief. No emoji.`)).toBe(true)
    })
    it('are dropped alone when they hold cmd.exe syntax', () => {
      const t = codex(withOwn('a | b'))!
      expect(t).not.toContain('a | b')
      expect(t).toBe(brief({ settings: {} }))
    })
  })

  it('drops the lines of the features that are off, as the hook does', () => {
    const t = brief({ settings: {} })!
    expect(t).toContain('astera help')
    expect(t).not.toContain('astera app js')
  })

  // `-c developer_instructions` replaces the account's own value; the person's instructions win.
  it('steps aside when the account sets its own developer_instructions', () => {
    expect(brief({ settings: ALL_ON, codexConfig: 'model = "x"\ndeveloper_instructions = "mine"\n' })).toBeNull()
  })
  it('does not mistake a key inside a table for the account’s own', () => {
    expect(brief({ settings: ALL_ON, codexConfig: '[profiles.fast]\ndeveloper_instructions = "x"\n' })).not.toBeNull()
  })
})
