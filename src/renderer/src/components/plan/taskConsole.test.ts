import { describe, expect, it } from 'vitest'
import { BRIEF_FILES_MAX, BRIEF_REPORT_MAX, askAboutTask, briefOf, rangeOf } from './taskConsole'

const task = {
  title: 'Add retry',
  spec: 'Retry failed fetches.',
  acceptanceCriteria: ['retries 3 times', 'logs each retry'],
  result: 'Added retry to fetchAll.',
  gaps: 'No test for the timeout path.',
  notProvable: 'flock: not found on Windows',
  reviewIssues: [{ severity: 'major', title: 'No backoff', file: 'src/a.ts', line: 7, blocking: true }],
  links: { branch: 'astera/add-retry', commits: ['aaa111', 'bbb222'] }
}
const changes = { total: 2, files: [{ path: 'src/a.ts', status: 'modified', additions: 5, deletions: 1 }, { path: 'img.png', status: 'added', binary: true }] }

describe('rangeOf', () => {
  it('names the commits as a git range, oldest first', () => {
    expect(rangeOf(['aaa111', 'bbb222'])).toBe('aaa111^..bbb222')
    expect(rangeOf(['aaa111'])).toBe('aaa111^..aaa111')
  })
  it('is undefined without commits', () => {
    expect(rangeOf([])).toBeUndefined()
    expect(rangeOf(undefined)).toBeUndefined()
  })
})

describe('briefOf', () => {
  const brief = briefOf({ plan: 'Retry plan', task, changes })
  it('holds the plan, task, spec, criteria, report, gaps, review issues, branch, range and files', () => {
    for (const s of ['Retry plan', 'Add retry', 'Retry failed fetches.', 'retries 3 times', 'Added retry to fetchAll.', 'No test for the timeout path.', 'Not provable here:', 'flock: not found on Windows', 'No backoff', 'src/a.ts:7', 'astera/add-retry', 'aaa111^..bbb222', 'src/a.ts (modified, +5 −1)', 'img.png (added, binary)'])
      expect(brief).toContain(s)
  })
  it('ends with the instruction to answer from code and history without editing', () => {
    expect(brief).toContain('You are answering questions about this finished task.')
    expect(brief).toContain('git diff aaa111^..bbb222')
    expect(brief).toContain('Do not change files unless the person asks you to.')
  })
  it('leaves out sections the task does not have', () => {
    const bare = briefOf({ plan: 'p', task: { title: 't' }, changes: null })
    expect(bare).not.toMatch(/Gaps|Not provable|Review|Branch|Changed files/)
  })
  it('caps a huge report and file list, with a note', () => {
    const files = Array.from({ length: BRIEF_FILES_MAX + 10 }, (_, i) => ({ path: `f${i}.ts`, status: 'modified' as const }))
    const big = briefOf({ plan: 'p', task: { ...task, result: 'x'.repeat(BRIEF_REPORT_MAX * 2) }, changes: { total: files.length, files } })
    expect(big).toContain('report cut')
    expect(big).toContain('10 more files not listed')
    expect(big.length).toBeLessThan(BRIEF_REPORT_MAX * 2)
  })
})

describe('askAboutTask', () => {
  type Reply = { status: number; body: unknown }
  const door = (over: Record<string, Reply> = {}) => {
    const calls: Array<[string, unknown]> = []
    const replies: Record<string, Reply> = {
      'jobs-get': { status: 200, body: { id: 'job1', objective: 'Do it', title: 'Retry plan', cwd: '/repo' } },
      'tasks-get': { status: 200, body: { runId: 'job1', attempts: [] } },
      'tasks-list': { status: 200, body: [{ id: 'tsk1', ...task }] },
      'runs-get': { status: 200, body: { outcome: 'completed' } },
      'runs-changed-files': { status: 200, body: { runId: 'job1', reported: [], git: changes } },
      'sessions-create': { status: 200, body: { id: 'ses1' } },
      ...over
    }
    return { calls, command: async (cmd: string, args: unknown) => (calls.push([cmd, args]), replies[cmd]) }
  }
  it('creates a chat session in the plan repo root with the brief, then opens its tab', async () => {
    const d = door()
    const opened: string[] = []
    const out = await askAboutTask(d, 'job1', 'tsk1', (id) => opened.push(id))
    expect(out).toEqual({ ok: true })
    const [, args] = d.calls.find(([c]) => c === 'sessions-create')!
    expect(args).toMatchObject({ kind: 'chat', cwd: '/repo', title: 'Ask: Add retry' })
    expect((args as { prompt: string }).prompt).toContain('Added retry to fetchAll.')
    expect(opened).toEqual(['ses1'])
  })
  it('still opens when the changed files cannot be read', async () => {
    const d = door({ 'runs-changed-files': { status: 500, body: { error: 'x' } } })
    expect(await askAboutTask(d, 'job1', 'tsk1', () => {})).toEqual({ ok: true })
  })
  it('says why it failed: the plan, the task or the session was refused', async () => {
    expect(await askAboutTask(door({ 'jobs-get': { status: 404, body: { error: 'unknown job' } } }), 'job1', 'tsk1', () => {})).toEqual({ ok: false, error: 'unknown job' })
    expect(await askAboutTask(door({ 'tasks-get': { status: 404, body: null } }), 'job1', 'tsk1', () => {})).toMatchObject({ ok: false })
    expect(await askAboutTask(door({ 'sessions-create': { status: 409, body: { error: 'no account' } } }), 'job1', 'tsk1', () => {})).toEqual({ ok: false, error: 'no account' })
  })
})
