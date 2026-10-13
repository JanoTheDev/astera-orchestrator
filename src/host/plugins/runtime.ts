// Runs the enabled plugins (plugin runtime design P2, P9, P11-P13; spec §13-14): one process per plugin, the Host's own
// executable as Node on the launcher bundled beside the Host, JSON-RPC on its stdio. The plugin's calls are answered by
// the orch as the plugin, with the permissions its record grants; its stderr is its log. A crash restarts it after a
// backoff, and the third crash without a steady run between marks it failed until a person starts it again. Plugins do
// not keep the Host alive: they run while it runs.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { hostWorkerBaseEnv } from '../../core/host/spawn'
import { killProcessTree } from '../../core/run/kill'
import { redactSecrets } from '../../core/remote/redact'
import type { OrchCall } from '../../core/host/orchProtocol'
import { RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND, RpcError, createRpcPeer, type RpcPeer } from '../../core/plugins/rpc'
import { openHostLog, type HostLog } from '../log'
import { pluginsRoot } from './registry'

export interface PluginTimings {
  /** How long `initialize` may take: loading the entry and `activate`. */
  startMs: number
  /** How long a stopping plugin has after `shutdown`, and again after the kill. */
  stopGraceMs: number
  /** The waits before the first, second and later restarts. */
  backoffMs: readonly number[]
  /** A run this long resets the crash count. */
  stableMs: number
  /** The crash, counted from the last steady run, that marks the plugin failed. */
  failAfter: number
}

export const PLUGIN_TIMINGS: PluginTimings = { startMs: 30_000, stopGraceMs: 5_000, backoffMs: [1000, 2000, 5000], stableMs: 30_000, failAfter: 3 }

/** What the runtime needs to start a plugin, from its registry record and its installed copy. */
export interface PluginLaunch {
  id: string
  version: string
  /** Its folder name, which names its log too. */
  folder: string
  /** The installed copy, where it runs. */
  dir: string
  /** The entry file, absolute. */
  entry: string
  granted: readonly string[]
}

export interface PluginRunStatus {
  status: 'starting' | 'running' | 'stopped' | 'failed'
  reason?: string
  pid?: number
}

export interface PluginRuntime {
  /** Starts the plugin unless it is already starting or running. */
  start(p: PluginLaunch): void
  /** Starts it afresh: a failed plugin's crash count is cleared. */
  restart(p: PluginLaunch): void
  stop(id: string): Promise<void>
  stopAll(): Promise<void>
  status(id: string): PluginRunStatus | undefined
  logFile(folder: string): string
}

/** A plugin's log (design P13): `<profile>/plugins/logs/<folder>.log`, rotated to `.1` past 2 MiB. */
export const pluginLogFile = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'logs', `${folder}.log`)

/** A line of stderr longer than this is written in pieces, so a plugin printing without end cannot grow a buffer. */
const STDERR_LINE_MAX = 64 * 1024

interface Slot {
  launch: PluginLaunch
  state: 'starting' | 'running' | 'waiting' | 'stopped' | 'failed'
  /** Whether the plugin should be running: false once a stop was asked for. */
  wanted: boolean
  proc?: ChildProcess
  peer?: RpcPeer
  runningSince?: number
  /** What went wrong with the current or the last run, for the reason a person reads. */
  problem?: string
  failures: number
  reason?: string
  timers: Set<ReturnType<typeof setTimeout>>
  exited?: Promise<void>
  stopping?: Promise<void>
}

/** Kills the plugin and everything it started: taskkill /T on Windows; elsewhere the process group the plugin was
 *  started as the leader of. */
function killTree(proc: ChildProcess): void {
  if (process.platform === 'win32') return killProcessTree(proc)
  try {
    if (proc.pid !== undefined) process.kill(-proc.pid, 'SIGKILL')
  } catch {
    try {
      proc.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
}

/** The environment a plugin starts with: the Host's own, without what is the Host's alone (HOST_ONLY_ENV) and without
 *  any ASTERA_ variable (a plugin is no agent session and reaches the Host on its own channel), plus the switch that
 *  runs the Host's executable as Node, which the launcher removes before the plugin loads. */
export function pluginEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(hostWorkerBaseEnv(env))) if (!/^ASTERA_/i.test(k)) out[k] = v
  out.ELECTRON_RUN_AS_NODE = '1'
  return out
}

export function createPluginRuntime(d: {
  profileDir: string
  /** The Host's own executable (`process.execPath`). */
  exec: string
  /** out/main/plugin-host.js, beside the Host's own bundle. */
  launcher: string
  env: NodeJS.ProcessEnv
  host: () => { version: string; pid: number; startedAt: string; features: string[] }
  orch: Pick<OrchCall, 'call'>
  /** The Host's own log. */
  log: (m: string) => void
  spawn?: typeof nodeSpawn
  timings?: Partial<PluginTimings>
  now?: () => number
}): PluginRuntime {
  const t: PluginTimings = { ...PLUGIN_TIMINGS, ...d.timings }
  const spawn = d.spawn ?? nodeSpawn
  const now = d.now ?? Date.now
  const slots = new Map<string, Slot>()
  const logs = new Map<string, HostLog>()
  const logFile = (folder: string): string => pluginLogFile(d.profileDir, folder)
  const logOf = (folder: string): HostLog => {
    let l = logs.get(folder)
    if (!l) logs.set(folder, (l = openHostLog({ path: logFile(folder) })))
    return l
  }
  const say = (s: Slot, m: string): void => logOf(s.launch.folder).write(`[host] ${m}`)
  const later = (s: Slot, ms: number, f: () => void): void => {
    const timer = setTimeout(() => {
      s.timers.delete(timer)
      f()
    }, ms)
    s.timers.add(timer)
  }
  const clearTimers = (s: Slot): void => {
    for (const timer of s.timers) clearTimeout(timer)
    s.timers.clear()
  }

  /** A plugin's call, answered by the orch as that plugin with what its record grants (design P12). */
  const forward = async (s: Slot, granted: ReadonlySet<string>, params: unknown): Promise<unknown> => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : null
    const args = p?.args ?? {}
    if (!p || typeof p.cmd !== 'string' || typeof args !== 'object' || args === null || Array.isArray(args) || (p.request !== undefined && typeof p.request !== 'string'))
      throw new RpcError(RPC_INVALID_PARAMS, 'call needs { cmd, args?, request? }')
    try {
      const r = await d.orch.call({
        cmd: p.cmd,
        args: args as Record<string, unknown>,
        sessionId: '',
        from: { role: 'plugin', plugin: { id: s.launch.id, granted }, toOthers: () => {} },
        ...(typeof p.request === 'string' ? { request: p.request } : {})
      })
      return { status: r.status, body: r.body, ...(r.replayed === true ? { replayed: true } : {}), ...(r.observed === true ? { observed: true } : {}) }
    } catch (e) {
      return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } }
    }
  }

  function launch(s: Slot): void {
    const p = s.launch
    s.state = 'starting'
    s.problem = undefined
    s.runningSince = undefined
    let proc: ChildProcess
    try {
      proc = spawn(d.exec, [d.launcher], {
        cwd: p.dir,
        env: pluginEnv(d.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Elsewhere than Windows, the leader of a process group, so a stop can end what the plugin started too.
        detached: process.platform !== 'win32'
      })
    } catch (e) {
      s.problem = `it could not be started: ${e instanceof Error ? e.message : String(e)}`
      return crashed(s, s.problem)
    }
    s.proc = proc
    let resolveExit: () => void = () => {}
    s.exited = new Promise((r) => (resolveExit = r))
    say(s, `started pid ${proc.pid ?? '?'}`)
    const granted: ReadonlySet<string> = new Set(p.granted)
    const peer = createRpcPeer({
      send: (line) => void proc.stdin?.write(line),
      onBadMessage: (m) => say(s, m),
      onRequest: async (method, params) => {
        if (method === 'call') return forward(s, granted, params)
        throw new RpcError(RPC_METHOD_NOT_FOUND, `no method ${method}`)
      }
    })
    s.peer = peer
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (c: string) => peer.feed(c))
    let held = ''
    const line = (l: string): void => {
      const text = l.replace(/\r$/, '')
      if (text !== '') logOf(p.folder).write(redactSecrets(text))
    }
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (c: string) => {
      held += c
      for (let i = held.indexOf('\n'); i >= 0; i = held.indexOf('\n')) {
        line(held.slice(0, i))
        held = held.slice(i + 1)
      }
      while (held.length > STDERR_LINE_MAX) {
        line(held.slice(0, STDERR_LINE_MAX))
        held = held.slice(STDERR_LINE_MAX)
      }
    })
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) stream?.on('error', (e) => say(s, `${e.name}: ${e.message}`))
    let ended = false
    const end = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (ended) return
      ended = true
      if (held !== '') line(held)
      resolveExit()
      exitedWith(s, proc, code, signal)
    }
    proc.on('exit', (code, signal) => {
      // Give the pipes a moment to deliver their last lines; `close` usually comes first.
      setTimeout(() => end(code, signal), 200)
    })
    proc.on('close', (code, signal) => end(code, signal))
    proc.on('error', (e) => {
      s.problem ??= `it could not be started: ${e.message}`
      end(null, null)
    })
    later(s, t.startMs, () => {
      if (s.proc !== proc || s.state !== 'starting') return
      s.problem = `it did not finish starting within ${t.startMs / 1000} s`
      say(s, s.problem)
      killTree(proc)
    })
    const host = d.host()
    peer
      .request('initialize', {
        apiVersion: '1',
        plugin: { id: p.id, version: p.version, dir: p.dir, entry: p.entry, permissions: [...p.granted] },
        host: { version: host.version, pid: host.pid, startedAt: host.startedAt, features: [...host.features] }
      })
      .then(
        () => {
          if (s.proc !== proc || s.state !== 'starting') return
          s.state = 'running'
          s.runningSince = now()
          say(s, 'running')
        },
        (e: unknown) => {
          if (s.proc !== proc || !s.wanted) return
          s.problem ??= e instanceof Error ? e.message : String(e)
          say(s, `did not start: ${s.problem}`)
          killTree(proc)
        }
      )
  }

  function exitedWith(s: Slot, proc: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (s.proc !== proc) return
    s.proc = undefined
    s.peer?.close('the plugin exited')
    s.peer = undefined
    say(s, signal ? `exited on signal ${signal}` : `exited with code ${code ?? '?'}`)
    if (!s.wanted) {
      clearTimers(s)
      s.state = 'stopped'
      say(s, 'stopped')
      return
    }
    clearTimers(s)
    crashed(s, s.problem ?? (signal ? `it exited on signal ${signal}` : `it exited with code ${code ?? '?'}`))
  }

  function crashed(s: Slot, problem: string): void {
    const ran = s.runningSince !== undefined ? now() - s.runningSince : 0
    if (ran >= t.stableMs) s.failures = 0
    s.failures += 1
    s.problem = problem
    if (s.failures >= t.failAfter) {
      s.state = 'failed'
      const times = s.failures === 1 ? '' : ` (${s.failures} times in a row, each within ${t.stableMs / 1000} s of starting)`
      s.reason = `${problem}${times}; see astera plugins logs --id ${s.launch.id}`
      say(s, `failed: ${s.reason}`)
      d.log(`plugins: ${s.launch.id} failed: ${problem}`)
      return
    }
    const wait = t.backoffMs[Math.min(s.failures - 1, t.backoffMs.length - 1)] ?? 1000
    s.state = 'waiting'
    say(s, `restarting in ${wait / 1000} s`)
    later(s, wait, () => {
      if (s.wanted && s.state === 'waiting') launch(s)
    })
  }

  const start = (p: PluginLaunch): void => {
    const s = slots.get(p.id)
    if (s && s.wanted && (s.state === 'starting' || s.state === 'running' || s.state === 'waiting')) return
    // A stop still under way finishes first; the start follows it.
    if (s?.stopping) {
      void s.stopping.then(() => start(p))
      return
    }
    const slot: Slot = s ?? { launch: p, state: 'stopped', wanted: true, failures: 0, timers: new Set() }
    slot.launch = p
    slot.wanted = true
    slot.reason = undefined
    if (slot.state !== 'failed') slot.failures = 0
    slots.set(p.id, slot)
    if (slot.state === 'failed') return
    launch(slot)
  }

  const stop = (id: string): Promise<void> => {
    const s = slots.get(id)
    if (!s) return Promise.resolve()
    s.wanted = false
    clearTimers(s)
    const proc = s.proc
    if (!proc) {
      s.state = 'stopped'
      return Promise.resolve()
    }
    return (s.stopping ??= (async () => {
      const exited = s.exited ?? Promise.resolve()
      const within = (ms: number): Promise<boolean> =>
        Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
      s.peer?.request('shutdown', {}).catch(() => {})
      if (!(await within(t.stopGraceMs))) {
        say(s, `did not stop within ${t.stopGraceMs / 1000} s of shutdown; killing it and what it started`)
        killTree(proc)
        if (!(await within(t.stopGraceMs))) {
          say(s, 'was given up on after the kill')
          if (s.proc === proc) {
            s.proc = undefined
            s.state = 'stopped'
          }
        }
      }
    })().finally(() => {
      s.stopping = undefined
    }))
  }

  return {
    start,
    restart: (p) => {
      const s = slots.get(p.id)
      if (s) {
        s.failures = 0
        s.reason = undefined
        if (s.state === 'failed') s.state = 'stopped'
      }
      start(p)
    },
    stop,
    stopAll: async () => {
      await Promise.all([...slots.keys()].map(stop))
      for (const l of logs.values()) l.close()
    },
    status: (id) => {
      const s = slots.get(id)
      if (!s) return undefined
      const pid = s.proc?.pid
      switch (s.state) {
        case 'running':
          return { status: 'running', ...(pid !== undefined ? { pid } : {}) }
        case 'starting':
          return { status: 'starting', ...(pid !== undefined ? { pid } : {}) }
        case 'waiting':
          return { status: 'starting', reason: `restarting after ${s.problem ?? 'a crash'}` }
        case 'failed':
          return { status: 'failed', ...(s.reason !== undefined ? { reason: s.reason } : {}) }
        default:
          return { status: 'stopped' }
      }
    },
    logFile
  }
}
