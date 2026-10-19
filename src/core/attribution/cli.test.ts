// W8-A: `astera blame|stats|why` over a real temp repository.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { attributionReply, runAttribution } from './cli'
import { writeNote, type AttributionNote } from './note'

const AI: AttributionNote = { v: 1, tool: 'astera', job: 'job_1', task: 'tsk_1', session: 'sess_9', agent: 'claude', model: 'opus', account: 'acc', role: 'worker' }

async function repo(): Promise<{ dir: string; ai: string }> {
  const dir = await makeRepo()
  await fs.writeFile(path.join(dir, 'f.txt'), 'human line\n', 'utf8')
  gitSync(dir, ['commit', '-am', 'human'])
  await fs.appendFile(path.join(dir, 'f.txt'), 'ai line\n', 'utf8')
  gitSync(dir, ['commit', '-am', 'ai'])
  const ai = gitSync(dir, ['rev-parse', 'HEAD'])
  await writeNote(dir, ai, AI)
  return { dir, ai }
}

async function call(dir: string, ...argv: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = []
  const code = await runAttribution(argv, { cwd: dir, out: (t) => lines.push(t) })
  return { code, text: lines.join('\n') }
}

describe('astera blame|stats|why', () => {
  it('blame names the AI line, stats answers git-ai fields, why opens the session', async () => {
    const { dir, ai } = await repo()
    const blame = await call(dir, 'blame', 'f.txt', '--json')
    expect(blame.code).toBe(0)
    expect(JSON.parse(blame.text).map((l: { kind: string }) => l.kind)).toEqual(['human', 'ai'])
    const stats = await call(dir, 'attribution-stats', '--json')
    expect(JSON.parse(stats.text)).toMatchObject({ ai_additions: 1, human_additions: 0 })
    const why = await call(dir, 'why', 'f.txt:2')
    expect(why.text).toContain(`${ai}: claude/opus`)
    expect(why.text).toContain('Task:    tsk_1')
    expect(why.text).toContain('astera sessions read --id sess_9')
    expect((await call(dir, 'why', 'HEAD~1')).text).toContain('a person made it')
  })

  it('refuses a missing argument with 2 and an unknown commit with 1', async () => {
    const { dir } = await repo()
    expect((await call(dir, 'blame')).code).toBe(2)
    expect((await call(dir, 'why', 'nope')).code).toBe(1)
  })
})

describe('attributionReply (the app\'s blame and stats)', () => {
  it('blame by file with the session; stats over a Task\'s commits or a range; bad input refused', async () => {
    const { dir, ai } = await repo()
    const blame = await attributionReply(dir, 'attribution-blame', { file: 'f.txt' })
    expect(blame.status).toBe(200)
    expect(blame.body).toMatchObject([{ line: 1, kind: 'human' }, { line: 2, kind: 'ai', task: 'tsk_1', session: 'sess_9', agent: 'claude' }])
    expect((await attributionReply(dir, 'attribution-stats', { commits: [ai] })).body).toMatchObject({ ai_additions: 1, human_additions: 0 })
    const all = (await attributionReply(dir, 'attribution-stats', { range: 'HEAD' })).body as { ai_additions: number; human_additions: number }
    expect(all.ai_additions).toBe(1)
    expect(all.human_additions).toBeGreaterThan(0) // every commit of HEAD, the people's ones too
    expect((await attributionReply(dir, 'attribution-blame', {})).status).toBe(400)
    expect((await attributionReply(dir, 'attribution-stats', { range: '--all' })).body).toMatchObject({ ai_additions: 1, human_additions: 0 })
  })
})
