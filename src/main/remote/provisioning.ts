// Settings › Remote Runtimes › Add a machine over SSH (T12b): the CLI's `machines add` (cli/machines.ts) run from the
// app's main process, its steps sent to the window as they happen. It pairs through this app's own RemoteRuntimes, so
// the new machine's client is the one every view then uses. The app has no terminal: an install that needs sudo to
// ask for a password fails with the fix that says so.
import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { addMachine, machineSearchDirs, type AddMachineOptions, type AddMachineResult, type ExecResult, type MachineDeps, type MachineProgress } from '../../cli/machines'
import type { RemoteRuntimes } from './runtimes'

/** An install runs apt and setup; a quarter of an hour is far past a slow one. */
const EXEC_TIMEOUT_MS = 15 * 60_000

export const execSsh = (file: 'ssh' | 'scp', args: string[]): Promise<ExecResult> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 << 20, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 255) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && code === 255 ? err.message : '') })
    })
  })

export async function listInstallers(dirs: string[]): Promise<string[]> {
  const found = await Promise.all(dirs.map((d) => fs.readdir(d).then((xs) => xs.map((x) => path.join(d, x)), () => [] as string[])))
  return found.flat()
}

export function createMachineProvisioner(a: {
  remote: RemoteRuntimes
  installerDirs?: string[]
  /** Test seam: the ssh and scp runner. */
  exec?: MachineDeps['exec']
}): { add(o: AddMachineOptions, onProgress: (p: MachineProgress) => void): Promise<AddMachineResult> } {
  const dirs = machineSearchDirs({
    cliEntry: path.join(__dirname, 'cli.js'),
    cwd: process.cwd(),
    home: os.homedir(),
    resourcesPath: (process as { resourcesPath?: string }).resourcesPath
  })
  const deps: MachineDeps = {
    exec: a.exec ?? ((file, args) => execSsh(file, args)),
    tty: false,
    installers: () => listInstallers(a.installerDirs ?? dirs.installerDirs),
    scriptsDir: () => dirs.scriptDirs.find((d) => existsSync(path.join(d, 'install-runtime.sh'))),
    exists: (p) => existsSync(p),
    random: () => randomBytes(4).toString('hex'),
    paired: () => a.remote.list(),
    pair: async (pairing, name) => {
      const r = await a.remote.add(pairing, name)
      return r.ok ? { ok: true, runtimeId: String(r.runtime.runtimeId), name: String(r.runtime.name) } : r
    },
    ping: async (runtimeId) => {
      const c = await a.remote.client(runtimeId)
      return !('code' in c) && (await c.ping().catch(() => ({ ok: false }))).ok
    }
  }
  return { add: (o, onProgress) => addMachine(o, deps, onProgress) }
}
