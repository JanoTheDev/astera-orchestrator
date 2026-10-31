#!/usr/bin/env node
// Memory sampler: where does the RAM go while many agents run?
//
//   node scripts/perf-memory.mjs --minutes 30 --out <scratch.jsonl>   (every 5 s by default)
//   node scripts/perf-memory.mjs --summary-of <scratch.jsonl>          (summarise a recorded run)
//
// Every sample is one JSON line: per process group count / working set / private bytes, plus the
// machine totals (total, available = what os.freemem() reports, standby, free, commit charge vs.
// limit). It only reads process lists and counters; it never touches a process. A table of peak and
// median per group is printed when the run ends (also on Ctrl+C). Windows first (one PowerShell
// call per sample); Linux reads `ps` and /proc/meminfo.
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MB = 1024 * 1024

/** Group ids in the order a row is printed. The first matching rule in classifyProcess wins. */
export const GROUPS = [
  'claude',
  'mcp',
  'codex',
  'install',
  'typecheck',
  'test',
  'git',
  'esbuild',
  'astera-app',
  'astera-host',
  'other',
]

/** File name of an image or path, lower case, for both `\` and `/` separators. */
export function imageName(name) {
  const s = String(name ?? '').trim().replace(/^"|"$/g, '')
  return s.slice(Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')) + 1).toLowerCase()
}

/**
 * Process group by image name and command line (not by image name alone: an MCP server, a vitest
 * worker and the Astera Host are all `node.exe`). Windows command lines keep their backslashes and
 * quotes; they are normalised to forward slashes before matching.
 * @param {{ name?: string, cmd?: string }} p
 */
export function classifyProcess(p) {
  const name = imageName(p.name)
  const cmd = String(p.cmd ?? '').replace(/["^]/g, '').replace(/\\+/g, '/').toLowerCase()
  const isNode = /^(node|nodejs)(\.exe)?$/.test(name)
  const has = (re) => re.test(cmd)

  if (name.startsWith('astera-host')) return 'astera-host'
  if (name === 'astera.exe' || name === 'astera') return 'astera-app'
  // `cmd.exe /d /c call claude.cmd …` is the shell shim every Claude session runs under on Windows.
  if (name === 'cmd.exe' && has(/claude\.cmd/)) return 'claude'
  if (name === 'claude.exe' || name === 'claude' || (isNode && has(/@anthropic-ai\/claude-code\/|\/claude-code\/cli\.js/))) return 'claude'
  if (name === 'codex.exe' || name === 'codex' || has(/@openai\/codex|\/codex(\.exe|\.js)?( |$)/)) return 'codex'

  if (has(/\bvitest\b|\bjest\b|\/vitest\/|\bbun(\.exe)? test\b|\bplaywright test\b/) || (name.startsWith('bun') && has(/ test( |$)/))) return 'test'
  if (name === 'turbo.exe' || name === 'turbo' || has(/\bvue-tsc\b|\/tsc(\.js|\.exe)?( |$)|typescript\/lib\/tsc|\bturbo(\.exe)?( |$)|\btsc( |$)/)) return 'typecheck'

  if (name === 'esbuild.exe' || name === 'esbuild' || has(/\/esbuild(\.exe)?( |$)|\/esbuild\/bin/)) return 'esbuild'
  if (name === 'git.exe' || name === 'git' || /^git-[\w-]+(\.exe)?$/.test(name)) return 'git'

  if (/^bunx?(\.exe)?$/.test(name) && has(/ (install|i|add|ci)( |$)/)) return 'install'
  if (isNode && has(/npm-cli\.js (ci|install|i)( |$)|\bnpm(\.cmd)? (ci|install)( |$)/)) return 'install'

  // MCP servers are started through `npx -y <scoped package>` (and the package's own node child).
  if (name === 'npx' || name === 'npx.cmd' || name === 'cmd.exe' || isNode) {
    if (has(/npx(-cli\.js|\.cmd)? +-y /) && has(/@[\w.-]+\//)) return 'mcp'
    if (has(/context7-mcp|mcp-server|-mcp[@/ ]|\/mcp\/|@modelcontextprotocol\//)) return 'mcp'
  }
  return 'other'
}

/** @param {number[]} xs */
export function median(xs) {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Fold a process list into per-group count / working set / private bytes.
 * @param {{ name?: string, cmd?: string, ws?: number, priv?: number }[]} procs
 */
export function groupProcesses(procs) {
  /** @type {Record<string, { count: number, ws: number, priv: number }>} */
  const out = {}
  for (const g of GROUPS) out[g] = { count: 0, ws: 0, priv: 0 }
  for (const p of procs) {
    const g = out[classifyProcess(p)]
    g.count += 1
    g.ws += Number(p.ws) || 0
    g.priv += Number(p.priv) || 0
  }
  return out
}

/** Private bytes per image name inside the "other" group, largest ten. */
export function topOther(procs, n = 10) {
  const by = new Map()
  for (const p of procs) {
    if (classifyProcess(p) !== 'other') continue
    const k = imageName(p.name)
    const e = by.get(k) ?? { count: 0, priv: 0 }
    e.count += 1
    e.priv += Number(p.priv) || 0
    by.set(k, e)
  }
  return Object.fromEntries([...by].sort((a, b) => b[1].priv - a[1].priv).slice(0, n))
}

/**
 * Peak and median per group, and the machine figures, over the recorded samples.
 * A sample is { t, groups: {id: {count, ws, priv}}, machine: {total, available, standby, free, commitUsed, commitLimit} }.
 */
export function summarize(samples) {
  const groups = {}
  for (const id of GROUPS) {
    const g = samples.map((s) => s.groups?.[id] ?? { count: 0, ws: 0, priv: 0 })
    groups[id] = {
      peakCount: Math.max(0, ...g.map((x) => x.count)),
      medianCount: median(g.map((x) => x.count)),
      peakWs: Math.max(0, ...g.map((x) => x.ws)),
      medianWs: median(g.map((x) => x.ws)),
      peakPriv: Math.max(0, ...g.map((x) => x.priv)),
      medianPriv: median(g.map((x) => x.priv)),
    }
  }
  const sum = (s) => Object.values(s.groups ?? {}).reduce((a, x) => a + x.priv, 0)
  const m = samples.map((s) => s.machine ?? {}).filter((x) => x.total)
  const headroom = m.filter((x) => x.commitLimit).map((x) => (100 * (x.commitLimit - x.commitUsed)) / x.commitLimit)
  const machine = {
    total: m[0]?.total ?? 0,
    minAvailable: m.length ? Math.min(...m.map((x) => x.available ?? 0)) : 0,
    medianAvailable: median(m.map((x) => x.available ?? 0)),
    maxStandby: Math.max(0, ...m.map((x) => x.standby ?? 0)),
    medianStandby: median(m.map((x) => x.standby ?? 0)),
    minFree: m.length ? Math.min(...m.map((x) => x.free ?? 0)) : 0,
    commitLimit: m[0]?.commitLimit ?? 0,
    peakCommit: Math.max(0, ...m.map((x) => x.commitUsed ?? 0)),
    medianCommit: median(m.map((x) => x.commitUsed ?? 0)),
    minCommitHeadroomPct: headroom.length ? Math.min(...headroom) : 0,
    peakGroupsPriv: Math.max(0, ...samples.map(sum)),
  }
  /** @type {Record<string, { count: number, priv: number }>} */
  const peakOther = {}
  for (const smp of samples)
    for (const [k, v] of Object.entries(smp.other ?? {})) {
      const e = peakOther[k]
      if (!e || v.priv > e.priv) peakOther[k] = v
    }
  const otherTop = Object.entries(peakOther).sort((a, b) => b[1].priv - a[1].priv).slice(0, 10)
  return { samples: samples.length, groups, machine, otherTop }
}

const mb = (n) => String(Math.round(n / MB)).padStart(7)
const gb = (n) => (n / (MB * 1024)).toFixed(2)

/** Plain-text table of a summarize() result. */
export function formatSummary(sum) {
  const lines = [`samples: ${sum.samples}`, '']
  lines.push('group          peak#  med#  peak priv MB  med priv MB  peak ws MB  med ws MB')
  for (const id of GROUPS) {
    const g = sum.groups[id]
    lines.push(
      `${id.padEnd(14)} ${String(g.peakCount).padStart(5)} ${String(Math.round(g.medianCount)).padStart(5)} ` +
        `${mb(g.peakPriv).padStart(13)} ${mb(g.medianPriv).padStart(12)} ${mb(g.peakWs).padStart(11)} ${mb(g.medianWs).padStart(10)}`,
    )
  }
  const m = sum.machine
  lines.push(
    '',
    `machine total ${gb(m.total)} GB; available min ${gb(m.minAvailable)} / median ${gb(m.medianAvailable)} GB; ` +
      `standby max ${gb(m.maxStandby)} / median ${gb(m.medianStandby)} GB; free min ${gb(m.minFree)} GB`,
    `commit: peak ${gb(m.peakCommit)} GB of limit ${gb(m.commitLimit)} GB (median ${gb(m.medianCommit)}); ` +
      `lowest headroom ${m.minCommitHeadroomPct.toFixed(1)} %`,
    `sum of group private bytes at its peak: ${gb(m.peakGroupsPriv)} GB`,
    '',
    'largest images in "other" (peak private MB, count then):',
    ...(sum.otherTop ?? []).map(([k, v]) => `  ${k.padEnd(28)} ${mb(v.priv)}  x${v.count}`),
  )
  return lines.join('\n')
}

// ---- Collectors (the only impure part) ---------------------------------------------------------

const PS_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$os = Get-CimInstance Win32_OperatingSystem
$p = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; cmd = $_.CommandLine; ws = [int64]$_.WorkingSetSize; priv = [int64]$_.PrivatePageCount } })
[pscustomobject]@{
  total = [int64]$os.TotalVisibleMemorySize * 1024
  available = [int64]$m.AvailableBytes
  standby = [int64]$m.StandbyCacheNormalPriorityBytes + [int64]$m.StandbyCacheReserveBytes + [int64]$m.StandbyCacheCoreBytes
  free = [int64]$m.FreeAndZeroPageListBytes
  modified = [int64]$m.ModifiedPageListBytes
  commitUsed = [int64]$m.CommittedBytes
  commitLimit = [int64]$m.CommitLimit
  procs = $p
} | ConvertTo-Json -Compress -Depth 3
`

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))))
  })
}

/** Parse the JSON the PowerShell script prints into { machine, procs }. Exported for tests. */
export function parseWindowsSample(text) {
  const j = JSON.parse(text)
  const procs = (Array.isArray(j.procs) ? j.procs : j.procs ? [j.procs] : []).map((p) => ({
    name: p.name,
    cmd: p.cmd ?? '',
    ws: p.ws,
    priv: p.priv,
  }))
  return {
    machine: {
      total: j.total,
      available: j.available,
      standby: j.standby,
      free: j.free,
      modified: j.modified,
      commitUsed: j.commitUsed,
      commitLimit: j.commitLimit,
    },
    procs,
  }
}

/** Parse `ps -eo rss=,comm=,args=` and /proc/meminfo text (Linux). Exported for tests. */
export function parseLinuxSample(psText, meminfo, swapNote = {}) {
  const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0) * 1024
  const procs = psText
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ name: m[2], cmd: m[3], ws: Number(m[1]) * 1024, priv: Number(m[1]) * 1024 }))
  return {
    machine: {
      total: kb('MemTotal'),
      available: kb('MemAvailable'),
      standby: kb('Cached'),
      free: kb('MemFree'),
      commitUsed: kb('Committed_AS'),
      commitLimit: kb('CommitLimit'),
      ...swapNote,
    },
    procs,
  }
}

async function collect() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT])
    return parseWindowsSample(out)
  }
  const [ps, meminfo] = await Promise.all([run('ps', ['-eo', 'rss=,comm=,args=']), Promise.resolve(readFileSync('/proc/meminfo', 'utf8'))])
  return parseLinuxSample(ps, meminfo)
}

function parseArgs(argv) {
  const o = { seconds: 5, minutes: 30, out: null, summaryOf: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--seconds') o.seconds = Number(argv[++i])
    else if (a === '--minutes') o.minutes = Number(argv[++i])
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--summary-of') o.summaryOf = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  if (!(o.seconds > 0) || !(o.minutes > 0)) throw new Error('--seconds and --minutes must be positive')
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.summaryOf) {
    const samples = readFileSync(o.summaryOf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    console.log(formatSummary(summarize(samples)))
    return
  }
  const samples = []
  let stop = false
  process.on('SIGINT', () => (stop = true))
  if (o.out) writeFileSync(o.out, '')
  const end = Date.now() + o.minutes * 60_000
  console.error(`perf-memory: ${o.seconds}s interval for ${o.minutes} min${o.out ? ` -> ${o.out}` : ''} (Ctrl+C ends early)`)
  while (!stop && Date.now() < end) {
    const started = Date.now()
    try {
      const { machine, procs } = await collect()
      const sample = { t: new Date().toISOString(), machine, groups: groupProcesses(procs), other: topOther(procs), os: { freemem: os.freemem() } }
      samples.push(sample)
      if (o.out) appendFileSync(o.out, JSON.stringify(sample) + '\n')
      else console.log(JSON.stringify(sample))
    } catch (e) {
      console.error(`perf-memory: sample failed: ${e instanceof Error ? e.message : e}`)
    }
    const wait = o.seconds * 1000 - (Date.now() - started)
    if (wait > 0 && !stop) await new Promise((r) => setTimeout(r, Math.min(wait, Math.max(0, end - Date.now()))))
  }
  console.log('\n' + formatSummary(summarize(samples)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
