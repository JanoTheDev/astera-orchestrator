import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  SUBAGENT_CAP_SCRIPT,
  maxSubagentsPerSessionOf,
  readSubagentCount,
  subagentCountFileOf,
  subagentStep
} from './subagentCap'

describe('subagentStep', () => {
  it('counts a subagent call up to the cap, then denies with the count and the limit', () => {
    let n = 0
    for (let i = 0; i < 3; i++) {
      const r = subagentStep(n, 'PreToolUse', 'Agent', 3)
      expect(r.deny).toBeNull()
      n = r.count
    }
    expect(n).toBe(3)
    const r = subagentStep(n, 'PreToolUse', 'Task', 3)
    expect(r).toEqual({
      count: 3,
      deny: 'Astera: 3 subagents already running in this tab (limit 3). Wait for one to finish.'
    })
  })

  it('a stop makes room again', () => {
    const stopped = subagentStep(3, 'SubagentStop', undefined, 3)
    expect(stopped).toEqual({ count: 2, deny: null })
    expect(subagentStep(stopped.count, 'PreToolUse', 'Agent', 3)).toEqual({ count: 3, deny: null })
  })

  it('a stray SubagentStop never goes below 0', () => {
    expect(subagentStep(0, 'SubagentStop', undefined, 10)).toEqual({ count: 0, deny: null })
  })

  it('a session start resets a crashed tab', () => {
    expect(subagentStep(10, 'SessionStart', undefined, 10)).toEqual({ count: 0, deny: null })
  })

  it('other tools and events leave the count alone', () => {
    expect(subagentStep(2, 'PreToolUse', 'Bash', 2)).toEqual({ count: 2, deny: null })
    expect(subagentStep(2, 'Stop', undefined, 2)).toEqual({ count: 2, deny: null })
  })
})

describe('maxSubagentsPerSessionOf', () => {
  it('takes 1 to 10, else the default 10', () => {
    expect(maxSubagentsPerSessionOf(1)).toBe(1)
    expect(maxSubagentsPerSessionOf(10)).toBe(10)
    for (const v of [0, 11, 2.5, '3', null, undefined]) expect(maxSubagentsPerSessionOf(v)).toBe(10)
  })
})

// The script Claude Code runs, under real node: the rule above, the counter file, the lock and the deny JSON.
describe('SUBAGENT_CAP_SCRIPT', () => {
  let dir: string
  let script: string
  let hookOut: string
  const run = (payload: object): { stdout: string; status: number | null } => {
    const r = spawnSync(process.execPath, [script], {
      input: JSON.stringify(payload),
      env: { ...process.env, ASTERA_HOOK_OUT: hookOut, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8'
    })
    return { stdout: r.stdout, status: r.status }
  }
  const pre = { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-subcap-'))
    script = path.join(dir, 'astera-subagent-cap.cjs')
    await fs.writeFile(script, SUBAGENT_CAP_SCRIPT)
    await fs.mkdir(path.join(dir, 'hook-events'))
    hookOut = path.join(dir, 'hook-events', 's1.jsonl')
    await fs.writeFile(path.join(dir, 'app-settings.json'), JSON.stringify({ maxSubagentsPerSession: 2 }))
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('lets calls through up to the cap from app-settings.json, then prints the PreToolUse deny', async () => {
    expect(run(pre)).toEqual({ stdout: '', status: 0 })
    expect(run(pre)).toEqual({ stdout: '', status: 0 })
    expect(await readSubagentCount(path.join(dir, 'hook-events'), 's1')).toBe(2)
    const denied = run(pre)
    expect(denied.status).toBe(0)
    expect(JSON.parse(denied.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Astera: 2 subagents already running in this tab (limit 2). Wait for one to finish.'
      }
    })
    expect(await readSubagentCount(path.join(dir, 'hook-events'), 's1')).toBe(2)
  })

  it('counts down on SubagentStop, never below 0, and resets on SessionStart', async () => {
    const hooks = path.join(dir, 'hook-events')
    run({ hook_event_name: 'SubagentStop' })
    expect(await readSubagentCount(hooks, 's1')).toBe(1)
    expect(run(pre).stdout).toBe('')
    run({ hook_event_name: 'SessionStart', source: 'resume' })
    expect(await readSubagentCount(hooks, 's1')).toBe(0)
    run({ hook_event_name: 'SubagentStop' })
    expect(await readSubagentCount(hooks, 's1')).toBe(0)
    expect(await fs.readFile(subagentCountFileOf(hookOut), 'utf8')).toBe('0')
  })

  it('lets everything through without ASTERA_HOOK_OUT or with a broken payload', () => {
    const bare = spawnSync(process.execPath, [script], {
      input: JSON.stringify(pre),
      env: { ...process.env, ASTERA_HOOK_OUT: '', ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8'
    })
    expect(bare.stdout).toBe('')
    expect(run({}).stdout).toBe('')
    const junk = spawnSync(process.execPath, [script], { input: 'not json', env: { ...process.env, ASTERA_HOOK_OUT: hookOut }, encoding: 'utf8' })
    expect(junk.status).toBe(0)
    expect(junk.stdout).toBe('')
  })
})
