// Workers never deliver: the guard script itself, run as Claude Code runs it (a PreToolUse payload on stdin).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { DELIVERY_GUARD_SCRIPT, deliveryRefusal } from './deliveryGuard'

let dir: string, script: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-delivery-guard-'))
  script = path.join(dir, 'astera-delivery-guard.cjs')
  await fs.writeFile(script, DELIVERY_GUARD_SCRIPT)
  // ses_worker holds an open Dispatch; ses_done's is closed; the coordinator holds none
  await fs.writeFile(
    path.join(dir, 'orchestration.json'),
    JSON.stringify({ dispatches: [{ sessionId: 'ses_worker' }, { sessionId: 'ses_done', endedAt: '2026-10-18T00:00:00Z' }] })
  )
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
const run = (session: string, command: string): string =>
  spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    env: { ...process.env, ASTERA_SESSION: session },
    encoding: 'utf8'
  }).stdout

describe('a worker cannot deliver', () => {
  it("refuses a worker's gh pr create and git push", () => {
    for (const cmd of ['gh pr create --fill', 'cd /x && git push -u origin HEAD', 'git -C /x push']) {
      const out = JSON.parse(run('ses_worker', cmd))
      expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(out.hookSpecificOutput.permissionDecisionReason).toContain('workers never deliver')
    }
  })
  it('lets a coordinator, a closed worker and an ordinary command through', () => {
    expect(run('ses_coord', 'gh pr create --fill')).toBe('')
    expect(run('ses_done', 'git push')).toBe('')
    expect(run('ses_worker', 'git commit -m "push the fix"')).toBe('')
    expect(run('ses_worker', 'git log; echo push')).toBe('')
  })
  it('the rule alone', () => {
    expect(deliveryRefusal('git push', false)).toBeNull()
    expect(deliveryRefusal('git pushd', true)).toBeNull()
    expect(deliveryRefusal('gh pr view', true)).toBeNull()
  })
})
