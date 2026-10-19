// W10-A Run as written by name through handleCommand: `jobs-create --mode prompts` with nothing attached finds the
// prompts the text names, refuses before any plan exists when one does not resolve, and `projects-set --prompts-dir`.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { renderPlanMd } from './planner'

const NOW = '2026-10-19T00:00:00.000Z'
const PLAN_MD = [
  '| Wave | Tabs | Prompts | Depends on |',
  '|---|---|---|---|',
  '| 1 | 2 | `P1-A-one`, `P1-B-two` | — |',
  '| 2 | 1 | `P2-A-three` | 1 merged |'
].join('\n')
const PROMPTS: Record<string, string> = {
  'P1-A-one.md': '# P1-A\n\nOne.\n',
  'P1-B-two.md': '# P1-B\n\nTwo.\n',
  'P1-C-spare.md': '# P1-C\n\nSpare.\n',
  'P2-A-three.md': '# P2-A\n\nThree.\n'
}

const rig = (opts: { dir?: string } = {}) => {
  const dir = opts.dir ?? 'docs/prompts'
  // The project is registered (the app does it on its first list)
  let state: OrchState = { ...emptyState(), projects: [{ id: 'p1', path: '/r', name: 'r', addedAt: NOW }] }
  const planners: string[] = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => ({ sessionId: 'ses-worker', cwd: '/r', specPath: '/s.md' }),
    startCoordinator: async (a: Record<string, unknown>) => {
      planners.push(String(a.role))
      return { sessionId: 'ses-planner' }
    },
    stopCoordinator: async () => {},
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW,
    intakeInputs: async (jobId: string, paths: string[]) => ({ dir: `/prof/plans/${jobId}/inputs`, names: paths.map((p) => p.split('/').pop()!) }),
    readIntakeText: async (file: string) => (file === '/r/docs/dev/PLAN.md' ? PLAN_MD : (PROMPTS[file.split('/').pop()!] ?? null)),
    listPromptFiles: async (d: string, depth: number) =>
      depth > 0 ? ['README.md', ...Object.keys(PROMPTS).map((f) => `${dir}/${f}`)] : d === `/r/${dir}` ? Object.keys(PROMPTS) : []
  } as unknown as OrchServerDeps
  const person = (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)
  return { deps, person, state: () => state, planners }
}
const create = (r: ReturnType<typeof rig>, objective: string, extra: Record<string, unknown> = {}) =>
  r.person('jobs-create', { cwd: '/r', mode: 'prompts', objective, coordinatorAccount: 'acc1', approve: 'ask', ...extra })

describe('Run as written by name', () => {
  it('`run P1-A, B then P2-A` with nothing attached: 3 Tasks in 2 waves, the folder detected and saved', async () => {
    const r = rig()
    const made = await create(r, 'run P1-A, B then P2-A')
    expect(made.status).toBe(200)
    const job = r.state().jobs[0]
    const tasks = r.state().tasks.filter((t) => t.jobId === job.id)
    expect(tasks.map((t) => [t.title, t.prompt])).toEqual([
      ['P1-A-one', PROMPTS['P1-A-one.md']],
      ['P1-B-two', PROMPTS['P1-B-two.md']],
      ['P2-A-three', PROMPTS['P2-A-three.md']]
    ])
    expect(tasks[2].deps).toEqual([tasks[0].id, tasks[1].id])
    expect(job.byName).toEqual({
      dir: 'docs/prompts',
      picked: [
        { id: 'P1-A', path: 'docs/prompts/P1-A-one.md' },
        { id: 'P1-B', path: 'docs/prompts/P1-B-two.md' },
        { id: 'P2-A', path: 'docs/prompts/P2-A-three.md' }
      ],
      skipped: [],
      why: []
    })
    // The text stays the owner's instructions
    expect(job.objective).toContain("Owner's instructions (they never change a prompt's text):\nrun P1-A, B then P2-A")
    expect(r.state().projects.find((p) => p.path === '/r')?.promptsDir).toBe('docs/prompts')
    // The approval shows each id's file
    expect(renderPlanMd(r.state(), job)).toContain('- P2-A → `docs/prompts/P2-A-three.md`')
  })

  it('`next waves` afterwards picks nothing: every wave is in that plan', async () => {
    const r = rig()
    await create(r, 'run P1-A, B then P2-A')
    const again = await create(r, 'next waves')
    expect(again.status).toBe(400)
    expect((again.body as { error: string }).error).toContain('next waves: nothing left')
    expect(r.state().jobs).toHaveLength(1)
  })

  it('`next wave` picks the first wave not done, and the approval says why', async () => {
    const r = rig()
    expect((await create(r, 'next wave')).status).toBe(200)
    const job = r.state().jobs[0]
    expect(job.byName?.picked.map((p) => p.id)).toEqual(['P1-A', 'P1-B'])
    expect(renderPlanMd(r.state(), job)).toContain('- Picked by next wave: wave 1 (P1-A, P1-B); the first wave of PLAN.md')
  })

  it('a refused name never makes a plan or starts a planner, and names each id', async () => {
    const r = rig()
    const res = await create(r, 'run P1-A, Z and P3-A…P4-B')
    expect(res.status).toBe(400)
    const error = (res.body as { error: string }).error
    expect(error).toContain('P1-Z: no file docs/prompts/P1-Z-*.md')
    expect(error).toContain('P3-A…P4-B: the range starts in P3 and ends in P4')
    expect(r.state().jobs).toEqual([])
    expect(r.planners).toEqual([])
  })

  it('attachments win: the names are not looked up, with a notice', async () => {
    const r = rig()
    const res = await create(r, 'run P2-A', { attach: ['/x/P1-A-one.md'] })
    expect(res.status).toBe(200)
    expect((res.body as { notice?: string }).notice).toBe('Using the 1 attached files; the names in the text were not looked up')
    expect(r.state().tasks.map((t) => t.title)).toEqual(['P1-A-one'])
    expect(r.state().jobs[0].objective).toContain('Using the 1 attached files; the names in the text were not looked up.')
  })

  it('dryRun (the Start page) answers the lookup and creates nothing', async () => {
    const r = rig()
    const res = await create(r, 'run P1-A', { dryRun: true })
    expect(res.body).toEqual({ names: true, dir: 'docs/prompts', detected: true, picked: [{ id: 'P1-A', path: 'docs/prompts/P1-A-one.md' }], skipped: [], why: [], problems: [] })
    expect((await create(r, '## a\nx\n## b\ny', { dryRun: true })).body).toEqual({ names: false })
    expect(r.state().jobs).toEqual([])
  })

  it('a project with no prompts folder anywhere is refused', async () => {
    const r = rig()
    r.deps.listPromptFiles = async () => ['README.md']
    const res = await create(r, 'run P1-A')
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toContain('no prompts folder')
  })
})

describe('projects-set --prompts-dir (W10-A)', () => {
  const withProject = async () => {
    const r = rig()
    return { r, id: 'p1' }
  }
  it('keeps it repository-relative; none clears it', async () => {
    const { r, id } = await withProject()
    expect((await r.person('projects-set', { id, promptsDir: '/r/other/prompts/' })).status).toBe(200)
    expect(r.state().projects[0].promptsDir).toBe('other/prompts')
    await r.person('projects-set', { id, promptsDir: 'none' })
    expect(r.state().projects[0].promptsDir).toBeUndefined()
  })
  it('a path outside the repository is refused', async () => {
    const { r, id } = await withProject()
    const res = await r.person('projects-set', { id, promptsDir: '../elsewhere' })
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toBe('--prompts-dir ../elsewhere: outside the repository (/r)')
  })
  it('a set folder is used instead of detecting one', async () => {
    const { r, id } = await withProject()
    await r.person('projects-set', { id, promptsDir: 'elsewhere' })
    const res = await create(r, 'run P1-B')
    expect((res.body as { error: string }).error).toContain('P1-B: no file elsewhere/P1-B-*.md')
  })
})
