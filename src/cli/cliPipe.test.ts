// The real CLI entry as a child process with stdout piped: a reply bigger than the pipe buffer must
// reach the reader whole. It used to stop at 64 KiB, cut mid-JSON, because `process.exit` ran while
// the rest of the reply still sat in the write queue of a non-blocking pipe.
//
// index.ts is bundled here with esbuild (no `npm run build` needed), packages left external and
// resolved through NODE_PATH, then run by plain node and, when it is installed, by Electron as node —
// the way the shuttle runs out/main/cli.js. No Host answers the profile, so `jobs list` reads the state
// file, which holds one Job whose objective alone is over 1 MB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { emptyState, type OrchState } from '../core/orchestration/state'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const electron = ((): string | null => {
  try {
    const p = createRequire(import.meta.url)('electron') as string
    return existsSync(p) ? p : null
  } catch {
    return null
  }
})()

let dir = ''
let entry = ''
const objective = 'x'.repeat(1_500_000)

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-cli-pipe-'))
  entry = path.join(dir, 'cli.js')
  await build({ entryPoints: [path.join(repo, 'src/cli/index.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: entry, logLevel: 'silent' })
  const state: OrchState = {
    ...emptyState(),
    jobs: [{ id: 'job_big', objective, cwd: dir, createdAt: '2026-10-20T00:00:00.000Z', concurrency: 1 } as OrchState['jobs'][number]]
  }
  await fs.writeFile(path.join(dir, 'orchestration.json'), JSON.stringify(state))
}, 60_000)

afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

/** Runs the bundle with stdout piped, and reads it only after the process has gone. */
const run = (exec: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(exec, [entry, 'jobs', 'list'], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: path.join(repo, 'node_modules'), ASTERA_PROFILE_DIR: dir, ...env },
      stdio: ['ignore', 'pipe', 'inherit']
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') }))
  })

describe('a CLI reply over 1 MB on a pipe', () => {
  const expectWhole = (r: { code: number | null; stdout: string }): void => {
    expect(r.stdout.length).toBeGreaterThan(1_000_000)
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { jobs: Array<{ id: string; objective: string }> } }
    expect(env.ok).toBe(true)
    expect(env.data.jobs.find((j) => j.id === 'job_big')?.objective).toHaveLength(objective.length)
    expect(r.code).toBe(0)
  }

  it('comes through whole under plain node', async () => {
    expectWhole(await run(process.execPath, {}))
  }, 60_000)

  it.runIf(electron !== null)('comes through whole under Electron as node', async () => {
    expectWhole(await run(electron!, { ELECTRON_RUN_AS_NODE: '1' }))
  }, 60_000)
})
