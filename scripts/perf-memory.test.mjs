// Memory sampler: command-line classification and summary maths (scripts/perf-memory.mjs).
// Windows command lines keep their backslashes and quotes, so they are written with String.raw.
import { describe, it, expect } from 'vitest'
import {
  classifyProcess,
  formatSummary,
  groupProcesses,
  imageName,
  median,
  parseLinuxSample,
  parseWindowsSample,
  summarize,
} from './perf-memory.mjs'

const NODE = String.raw`C:\Program Files\nodejs\node.exe`
const NPX_CLI = String.raw`C:\Program Files\nodejs\\node_modules\npm\bin\npx-cli.js`

describe('classifyProcess', () => {
  it('finds Claude sessions by image name, also from a full path', () => {
    expect(classifyProcess({ name: 'claude.exe', cmd: String.raw`"C:\Users\Jonx\.local\bin\claude.exe" --resume` })).toBe('claude')
    expect(classifyProcess({ name: String.raw`C:\Users\Jonx\.local\bin\claude.exe`, cmd: '' })).toBe('claude')
    expect(imageName(String.raw`"C:\Program Files\nodejs\node.exe"`)).toBe('node.exe')
  })

  it('tells an MCP server started through npx apart from other node processes', () => {
    const npx = String.raw`"${NODE}"  "${NPX_CLI}" "-y" "@upstash/context7-mcp@3.2.5"`
    expect(classifyProcess({ name: 'node.exe', cmd: npx })).toBe('mcp')
    const child = String.raw`"node"   "C:\dev\_caches\npm-cache\_npx\b1\node_modules\.bin\\..\@upstash\context7-mcp\dist\index.js" `
    expect(classifyProcess({ name: 'node.exe', cmd: child })).toBe('mcp')
    expect(classifyProcess({ name: 'node.exe', cmd: String.raw`node "C:\work\storybook\dist\bin\dispatcher.js" dev -p 6217` })).toBe('other')
  })

  it('counts the cmd.exe shims of a Claude session and of its MCP server with them', () => {
    expect(classifyProcess({ name: 'cmd.exe', cmd: String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c "npx ^"-y^" ^"@upstash/context7-mcp@3.2.5^""` })).toBe('mcp')
    expect(classifyProcess({ name: 'cmd.exe', cmd: String.raw`cmd.exe /d /c call C:\Users\Jonx\AppData\Roaming\npm\claude.cmd --resume abc` })).toBe('claude')
    expect(classifyProcess({ name: 'cmd.exe', cmd: String.raw`cmd.exe /c dir` })).toBe('other')
  })

  it('does not take npx vitest or npx tsc for an MCP server', () => {
    const npxCli = String.raw`"${NODE}" "${NPX_CLI}"`
    expect(classifyProcess({ name: 'node.exe', cmd: `${npxCli} vitest run --maxWorkers=2` })).toBe('test')
    expect(classifyProcess({ name: 'node.exe', cmd: `${npxCli} tsc -p tsconfig.json` })).toBe('typecheck')
  })

  it('groups test runners and their worker forks', () => {
    expect(classifyProcess({ name: 'node.exe', cmd: String.raw`"${NODE}" C:\repo\node_modules\vitest\dist\workers\forks.js` })).toBe('test')
    expect(classifyProcess({ name: 'bun.exe', cmd: 'bun test src/core' })).toBe('test')
  })

  it('groups typecheck tools', () => {
    expect(classifyProcess({ name: 'turbo.exe', cmd: 'turbo run typecheck' })).toBe('typecheck')
    expect(classifyProcess({ name: 'node.exe', cmd: String.raw`"${NODE}" C:\repo\node_modules\typescript\lib\tsc.js --noEmit` })).toBe('typecheck')
    expect(classifyProcess({ name: 'node.exe', cmd: String.raw`"${NODE}" C:\repo\node_modules\vue-tsc\bin\vue-tsc.js` })).toBe('typecheck')
  })

  it('separates bun install from other bun processes', () => {
    expect(classifyProcess({ name: 'bun.exe', cmd: 'bun install --frozen-lockfile' })).toBe('install')
    expect(classifyProcess({ name: 'bun.exe', cmd: 'bun run dev' })).toBe('other')
  })

  it('groups git, esbuild, codex and the Astera processes', () => {
    expect(classifyProcess({ name: 'git.exe', cmd: 'git merge feature' })).toBe('git')
    expect(classifyProcess({ name: 'git-remote-https.exe', cmd: '' })).toBe('git')
    expect(classifyProcess({ name: 'esbuild.exe', cmd: String.raw`C:\repo\node_modules\@esbuild\win32-x64\esbuild.exe --service` })).toBe('esbuild')
    expect(classifyProcess({ name: 'codex.exe', cmd: 'codex exec' })).toBe('codex')
    expect(classifyProcess({ name: 'astera-host.exe', cmd: String.raw`C:\Users\Jonx\AppData\Local\astera\host.js` })).toBe('astera-host')
    expect(classifyProcess({ name: 'Astera.exe', cmd: String.raw`"C:\Users\Jonx\AppData\Local\Programs\Astera\Astera.exe" --type=renderer` })).toBe('astera-app')
    expect(classifyProcess({ name: 'Discord.exe', cmd: '' })).toBe('other')
  })
})

describe('groupProcesses', () => {
  it('sums count, working set and private bytes per group', () => {
    const g = groupProcesses([
      { name: 'claude.exe', cmd: '', ws: 100, priv: 80 },
      { name: 'claude.exe', cmd: '', ws: 50, priv: 40 },
      { name: 'git.exe', cmd: 'git status', ws: 10, priv: 5 },
    ])
    expect(g.claude).toEqual({ count: 2, ws: 150, priv: 120 })
    expect(g.git).toEqual({ count: 1, ws: 10, priv: 5 })
    expect(g.mcp.count).toBe(0)
  })
})

describe('summarize', () => {
  const GB = 1024 ** 3
  const sample = (claudePriv, avail, commitUsed) => ({
    groups: { claude: { count: 2, ws: claudePriv, priv: claudePriv } },
    machine: { total: 31 * GB, available: avail, standby: 8 * GB, free: 1 * GB, commitUsed, commitLimit: 40 * GB },
  })

  it('takes the median of an odd and an even number of values', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })

  it('reports peak and median per group and the lowest commit headroom', () => {
    const s = summarize([sample(1 * GB, 10 * GB, 20 * GB), sample(3 * GB, 4 * GB, 30 * GB), sample(2 * GB, 6 * GB, 25 * GB)])
    expect(s.samples).toBe(3)
    expect(s.groups.claude.peakPriv).toBe(3 * GB)
    expect(s.groups.claude.medianPriv).toBe(2 * GB)
    expect(s.machine.minAvailable).toBe(4 * GB)
    expect(s.machine.peakCommit).toBe(30 * GB)
    expect(s.machine.minCommitHeadroomPct).toBeCloseTo(25, 5)
    expect(formatSummary(s)).toContain('claude')
  })

  it('copes with no samples', () => {
    expect(summarize([]).machine.peakCommit).toBe(0)
  })
})

describe('parsers', () => {
  it('reads the PowerShell JSON, also when a single process comes back as an object', () => {
    const one = parseWindowsSample(JSON.stringify({ total: 10, available: 5, standby: 3, free: 1, commitUsed: 6, commitLimit: 12, procs: { pid: 1, name: 'git.exe', cmd: null, ws: 7, priv: 4 } }))
    expect(one.procs).toEqual([{ name: 'git.exe', cmd: '', ws: 7, priv: 4 }])
    expect(one.machine.commitLimit).toBe(12)
  })

  it('reads ps and /proc/meminfo on Linux', () => {
    const s = parseLinuxSample('  2048 claude claude --resume\n  100 git git status\n', 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nCached: 300 kB\nMemFree: 100 kB\nCommitted_AS: 600 kB\nCommitLimit: 900 kB\n')
    expect(s.procs[0]).toEqual({ name: 'claude', cmd: 'claude --resume', ws: 2048 * 1024, priv: 2048 * 1024 })
    expect(s.machine.available).toBe(400 * 1024)
    expect(s.machine.commitUsed).toBe(600 * 1024)
  })
})
