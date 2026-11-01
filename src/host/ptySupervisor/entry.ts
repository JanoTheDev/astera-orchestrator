// The pty supervisor process: out/main/pty-supervisor.js, run by the Host with its own executable as Node (protocol.ts
// has the whole picture). Listens on the profile's supervisor address; a second one started while the first listens
// leaves at once. Logs to `<profile>/host/pty-supervisor.log`.
import childProcess from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import * as pty from 'node-pty'
import { hostKeyPath } from '../../core/publicContract'
import { hideAllChildConsoleWindows, hideForkedConsoleWindows, type ChildProcessProto } from '../../core/childWindows'
import { createConhostReaper, reapWindowsConsoleHosts } from '../conhostReaper'
import { createLineReader, encodeLine } from '../framing'
import { logUncaughtExceptions, logUnhandledRejections, openHostLog } from '../log'
import { killTree } from '../workspace/native'
import { HELLO_MS, SUPERVISOR_IDLE_ENV, SUPERVISOR_IDLE_MS, SUPERVISOR_PROFILE_ENV, supervisorAddress, type ToSupervisor } from './protocol'
import { createSupervisor } from './supervisor'

function main(): void {
  // As the Host does, before anything starts a child: node-pty's ConPTY kill forks a helper, and every other child
  // (taskkill, the conhost reap) would otherwise get a console window of its own.
  hideForkedConsoleWindows(childProcess, process.platform)
  hideAllChildConsoleWindows(childProcess.ChildProcess.prototype as unknown as ChildProcessProto, process.platform)
  const profileDir = process.env[SUPERVISOR_PROFILE_ENV]
  if (!profileDir) process.exit(2)
  const log = openHostLog({ path: path.join(profileDir, 'host', 'pty-supervisor.log') })
  logUnhandledRejections(process, log)
  logUncaughtExceptions(process, log, { code: 1 })
  const address = supervisorAddress(profileDir, process.platform)

  let listening = false
  const leave = (why: string): void => {
    log.write(`${why} — leaving`)
    log.close()
    // Only our own socket file: a second supervisor leaving must not take the first one's.
    if (listening && process.platform !== 'win32') rmSync(address, { force: true })
    process.exit(0)
  }
  // node-pty 1.1.0 leaves a console host per pty that ends by itself (conhostReaper.ts): they are this process's now.
  const reaper = createConhostReaper({
    platform: process.platform,
    hostPid: process.pid,
    livePtys: () => supervisor.liveCount(),
    reapChildren: (q) => reapWindowsConsoleHosts(q),
    log: (m) => log.write(m)
  })
  const supervisor = createSupervisor({
    spawn: (file, args, o) => {
      const p = pty.spawn(file, args, { name: 'xterm-256color', cwd: o.cwd, cols: o.cols, rows: o.rows, env: o.env })
      reaper.spawned()
      return p
    },
    killTree: (pid) => killTree(pid),
    log: (m) => log.write(m),
    // The Host made it before it bound (or its client did, before saying hello); read again at each hello.
    key: () => {
      try {
        const text = readFileSync(hostKeyPath(profileDir), 'utf8').trim()
        return /^[0-9a-f]{64}$/.test(text) ? text : null
      } catch {
        return null
      }
    },
    exited: () => reaper.exited(),
    idleMs: Number(process.env[SUPERVISOR_IDLE_ENV]) || SUPERVISOR_IDLE_MS,
    onIdle: () => leave('no pty and no Host')
  })

  const server = net.createServer((sock) => {
    sock.setEncoding('utf8')
    // A connection that does not say hello in time is not a Host.
    const helloTimer = setTimeout(() => sock.destroy(), HELLO_MS)
    helloTimer.unref()
    const conn = supervisor.connect(
      (m) => {
        if (m.t === 'welcome') clearTimeout(helloTimer)
        if (!sock.destroyed) sock.write(encodeLine(m))
      },
      () => sock.destroy()
    )
    const read = createLineReader({
      onMessage: (v) => conn.receive(v as ToSupervisor),
      onBadLine: (raw) => log.write(`a line that is not JSON: ${raw.slice(0, 80)}`),
      onHandlerError: (_v, err) => log.write(`a message could not be handled: ${String(err)}`)
    })
    sock.on('data', read)
    sock.on('error', () => {})
    sock.on('close', () => {
      clearTimeout(helloTimer)
      conn.close()
    })
  })
  const listen = (retried: boolean): void => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') return leave(`could not listen on ${address}: ${String(err)}`)
      // win32: the pipe is held, so a supervisor is there. posix: the socket file may be one left by a dead supervisor.
      const probe = net.connect(address)
      probe.once('connect', () => {
        probe.destroy()
        leave('another pty supervisor is already listening')
      })
      probe.once('error', () => {
        if (retried || process.platform === 'win32') return leave(`${address} is taken`)
        rmSync(address, { force: true })
        listen(true)
      })
    })
    server.listen(address, () => {
      listening = true
      log.write(`listening on ${address}, pid ${process.pid}`)
    })
  }
  if (process.platform !== 'win32') mkdirSync(path.dirname(address), { recursive: true })
  listen(false)
}

main()
