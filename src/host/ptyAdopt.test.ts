// T36: a Host crash with agent ptys live in the pty supervisor, then the next Host. The supervisor's state
// (supervisor.ts) and the Host's client (client.ts) over an in-memory wire, the next Host's real registry, fake ptys.
import { describe, it, expect } from 'vitest'
import type { PtyMeta, PtyOpenOptions } from '../core/host/protocol'
import { stateFromLegacy } from '../core/orchestration/legacyState'
import type { Dispatch } from '../core/orchestration/types'
import { PtyRegistry, type RegistryPty } from './registry'
import { adoptSurvivors, listSurvivors } from './ptyAdopt'
import { createPtySupervisorClient, type PtySupervisorClient, type SupervisorLink } from './ptySupervisor/client'
import type { FromSupervisor } from './ptySupervisor/protocol'
import { createSupervisor } from './ptySupervisor/supervisor'

let nextPid = 9000
class FakePty implements RegistryPty {
  pid = nextPid++
  dataCbs: ((d: string) => void)[] = []
  exitCbs: ((e: { exitCode: number }) => void)[] = []
  written: string[] = []
  kills = 0
  onData(cb: (d: string) => void): void {
    this.dataCbs.push(cb)
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCbs.push(cb)
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(): void {}
  kill(): void {
    this.kills++
    for (const cb of this.exitCbs) cb({ exitCode: 1 })
  }
  pause(): void {}
  resume(): void {}
  emit(d: string): void {
    for (const cb of this.dataCbs) cb(d)
  }
}

const OPTS: PtyOpenOptions = { cwd: '/wt/a', cols: 80, rows: 24, env: {} }
const session = (id: string): PtyMeta => ({ kind: 'session', id, restore: { cwd: `/wt/${id}`, accountId: 'acc_1' } })
const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m)) as T
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))
const NOW = '2026-11-01T10:00:00.000Z'
const dispatch = (over: Partial<Dispatch>): Dispatch => ({
  id: 'dsp_x', taskId: 'tsk_x', provider: 'claude', accountId: 'acc_1', sessionId: 'sess-x',
  cwd: '', specPath: '', startedAt: NOW, workerState: 'ready', retained: false, ...over
})

/** A supervisor, and a Host client over its own connection; `drop` is that Host dying. */
function rig() {
  const ptys: FakePty[] = []
  const treeKills: number[] = []
  const sup = createSupervisor({
    spawn: () => {
      const p = new FakePty()
      ptys.push(p)
      return p
    },
    killTree: async (pid) => void treeKills.push(pid),
    log: () => {},
    onIdle: () => {},
    after: () => () => {}
  })
  const host = (): { c: PtySupervisorClient; drop(): void } => {
    let cb: (m: FromSupervisor | null) => void = () => {}
    const conn = sup.connect((m) => cb(wire(m)))
    const link: SupervisorLink = { send: (m) => conn.receive(wire(m)), listen: (f) => (cb = f), close: () => conn.close() }
    const c = createPtySupervisorClient({
      link,
      request: (m) => {
        let answer: FromSupervisor | undefined
        const rc = sup.connect((r) => (answer = wire(r)))
        rc.receive(wire(m))
        rc.close()
        return answer ?? 'no-answer'
      },
      fallback: () => new FakePty(),
      log: () => {}
    })
    return { c, drop: () => (conn.close(), cb(null)) }
  }
  return { ptys, treeKills, host }
}

describe('adoptSurvivors (the next Host after a crash)', () => {
  it('registers a live supervisor pty under its session id, replays its ring then the live output, and kills one nobody names', async () => {
    const r = rig()
    // The Host that crashes: a worker with an open Dispatch, a tab in the saved list, and a stray session.
    const old = r.host()
    for (const id of ['sess-w', 'sess-tab', 'sess-stray']) old.c.spawn('claude', [], OPTS, session(id)).onData(() => {})
    await settle()
    const [worker, tab, stray] = r.ptys
    worker.emit('working on it ')
    old.drop()
    worker.emit('still working')

    const next = r.host()
    const logs: string[] = []
    const registry = new PtyRegistry({ spawn: () => new FakePty(), log: () => {} })
    const survivors = await listSurvivors(next.c, (m) => logs.push(m))
    expect(survivors).toHaveLength(3)
    const adopted = adoptSurvivors({
      survivors: survivors!,
      supervisor: next.c,
      registry,
      saved: [{ sessionId: 'sess-tab', accountId: 'acc_1', cwd: '/wt/sess-tab' }],
      state: stateFromLegacy({ dispatches: [dispatch({ id: 'dsp_w', sessionId: 'sess-w' }), dispatch({ id: 'dsp_old', sessionId: 'sess-stray', endedAt: NOW, outcome: 'succeeded' })] }),
      log: (m) => logs.push(m)
    })
    await settle()

    expect([...adopted].sort()).toEqual(['sess-tab', 'sess-w'])
    // Under the same session id, alive, as the load's `aliveSessionIds` reads it.
    const live = registry.list().filter((e) => e.alive && e.meta?.kind === 'session').map((e) => e.meta!.id)
    expect(live.sort()).toEqual(['sess-tab', 'sess-w'])
    const wid = registry.sessionPty('sess-w')!
    expect(registry.list().find((e) => e.id === wid)?.pid).toBe(worker.pid)
    // The ring first, then what comes after.
    expect(registry.buffer(wid)).toBe('working on it still working')
    worker.emit(' done')
    expect(registry.buffer(wid)).toBe('working on it still working done')
    registry.write(wid, 'x')
    expect(worker.written).toEqual(['x'])
    expect(tab.kills).toBe(0)

    // The stray: whole tree, then the pty, and one line.
    expect(r.treeKills).toEqual([stray.pid])
    expect(stray.kills).toBe(1)
    expect(registry.sessionPty('sess-stray')).toBeNull()
    expect(logs.filter((l) => l.includes('killed'))).toHaveLength(1)
    expect(logs.find((l) => l.includes('killed'))).toContain('sess-stray')
  })

  it('adopts nothing and says so once when the supervisor cannot be reached', async () => {
    const logs: string[] = []
    const unreachable = { list: () => Promise.reject(new Error('the pty supervisor cannot be reached')) }
    expect(await listSurvivors(unreachable, (m) => logs.push(m))).toBeNull()
    const silent = { list: () => new Promise<never>(() => {}) }
    expect(await listSurvivors(silent, (m) => logs.push(m), 10)).toBeNull()
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.includes('restore as before'))).toBe(true)
  })
})
