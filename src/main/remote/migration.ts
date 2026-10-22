// Settings › Remote Runtimes › Bring my setup (T12c): the CLI's `machines migrate` (cli/machineMigrate.ts) run from the
// app's main process, each item's result sent to the window as it lands. The app has no terminal: a Claude or Codex
// account is made on the machine and, as nobody can approve a setup-token or a login here, reported as needing a
// one-time login, with the terminal command that does it.
import { readMachines, localAccounts, localProjects, planMigration, runMigration, type ItemResult, type MigrateDeps, type MigrateMachine, type MigrateOptions, type MigrateResult, type PlanItem } from '../../cli/machineMigrate'
import { runExec } from '../../cli/machines'
import type { RemoteRuntimes } from './runtimes'

export interface MigrationRunner {
  /** The Runtimes whose SSH address `machines add` recorded: the ones that can be migrated (again). */
  machines(): Promise<string[]>
  plan(runtimeId: string, o: MigrateOptions): Promise<{ ok: true; plan: PlanItem[] } | { ok: false; message: string }>
  migrate(runtimeId: string, o: MigrateOptions, onProgress: (r: ItemResult) => void): Promise<MigrateResult>
}

export function createMigrationRunner(a: {
  remote: Pick<RemoteRuntimes, 'list' | 'client'>
  profileDir: string
  /** Test seams: ssh, and gh and git on this computer. */
  exec?: MigrateDeps['exec']
  local?: MigrateDeps['local']
}): MigrationRunner {
  const machineOf = async (runtimeId: string): Promise<MigrateMachine | null> => {
    const known = (await readMachines(a.profileDir))[runtimeId]
    const paired = (await a.remote.list()).find((r) => r.runtimeId === runtimeId)
    return known && paired ? { runtimeId, name: paired.name, os: known.os, target: known.target, port: known.port } : null
  }
  const deps = (runtimeId: string): MigrateDeps => ({
    // The app is the person's own clicks, never an agent session
    agentSession: false,
    tty: false,
    exec: a.exec ?? ((file, args, x) => runExec(file, args, x)),
    local: a.local ?? ((file, args, x) => runExec(file, args, { tty: false, ...(x?.cwd ? { cwd: x.cwd } : {}) })),
    accounts: () => localAccounts(a.profileDir),
    projects: () => localProjects(a.profileDir),
    remote: async (cmd, args) => {
      const c = await a.remote.client(runtimeId)
      if ('code' in c) return { ok: false, message: c.message }
      const r = await c.command(cmd, args).catch((e: unknown) => ({ status: 0, body: String(e) }))
      return r.status === 200 ? { ok: true, body: r.body } : { ok: false, message: `status ${r.status}` }
    },
    now: () => Date.now()
  })
  const missing = (runtimeId: string): string => `no SSH address is known for ${runtimeId}: add it with Add a machine over SSH, or run \`astera machines migrate\` with --target`
  return {
    machines: async () => Object.keys(await readMachines(a.profileDir)),
    plan: async (runtimeId, o) => {
      const m = await machineOf(runtimeId)
      return m ? { ok: true, plan: await planMigration(m, o, deps(runtimeId)) } : { ok: false, message: missing(runtimeId) }
    },
    // The window's button press is the confirmation, after it showed the plan: --yes
    migrate: async (runtimeId, o, onProgress) => {
      const m = await machineOf(runtimeId)
      return m ? runMigration(m, { ...o, yes: true }, deps(runtimeId), onProgress) : { ok: false, message: missing(runtimeId), plan: [], results: [] }
    }
  }
}
