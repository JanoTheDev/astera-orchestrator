import { describe, expect, it } from 'vitest'
import { HOST_UPDATE_CURRENT, HOST_UPDATE_HANDOVER_AFTER_MS, hostUpdateBanner, hostUpdateRestartWaitMs, nextHostUpdateState, type HostUpdateEvent, type HostUpdateState } from './hostUpdateState'

const look = (o: Partial<Extract<HostUpdateEvent, { t: 'observe' }>> = {}): HostUpdateEvent => ({ t: 'observe', outdated: true, agentsRunning: 3, sessionsBlocking: 1, nowMs: 1_000, ...o })
const run = (events: HostUpdateEvent[], from: HostUpdateState = HOST_UPDATE_CURRENT): HostUpdateState => events.reduce(nextHostUpdateState, from)

describe('hostUpdateState - an outdated Host on its way to the new build', () => {
  it('a current Host stays current', () => {
    expect(run([look({ outdated: false })])).toEqual({ kind: 'current' })
    expect(hostUpdateRestartWaitMs(HOST_UPDATE_CURRENT, 0)).toBeNull()
  })

  it('outdated with agents running waits, counting them, from the first look', () => {
    const s = run([look(), look({ agentsRunning: 2, sessionsBlocking: 0, nowMs: 5_000 })])
    expect(s).toEqual({ kind: 'outdated-waiting', agentsRunning: 2, sessionsBlocking: 0, since: 1_000 })
  })

  it('toggle on: the held restart is asked to wait what is left of 30 minutes, and hands over at 30 minutes', () => {
    const s = run([look()])
    expect(hostUpdateRestartWaitMs(s, 1_000)).toBe(HOST_UPDATE_HANDOVER_AFTER_MS)
    expect(hostUpdateRestartWaitMs(s, 1_000 + 10 * 60_000)).toBe(20 * 60_000)
    expect(hostUpdateRestartWaitMs(s, 1_000 + HOST_UPDATE_HANDOVER_AFTER_MS)).toBe(0)
    expect(hostUpdateRestartWaitMs(s, 1_000 + 2 * HOST_UPDATE_HANDOVER_AFTER_MS)).toBe(0)
  })

  it('toggle off waits the same way (the toggle is only read by the swap rule), and the agents draining shows as 0', () => {
    expect(run([look(), look({ agentsRunning: 0, sessionsBlocking: 0, nowMs: 9_000 })])).toEqual({ kind: 'outdated-waiting', agentsRunning: 0, sessionsBlocking: 0, since: 1_000 })
  })

  it('the Host leaving is restarting, and what the old Host still runs does not undo it', () => {
    const s = run([look(), { t: 'leaving', nowMs: 7_000 }, look({ nowMs: 8_000 })])
    expect(s).toEqual({ kind: 'restarting', since: 1_000 })
    expect(hostUpdateRestartWaitMs(s, 8_000)).toBeNull()
  })

  it('a restart asked while current (Restart now) is restarting from that moment', () => {
    expect(run([{ t: 'leaving', nowMs: 4_000 }])).toEqual({ kind: 'restarting', since: 4_000 })
  })

  it('back to current when the new Host answers, or when the Host is no longer outdated', () => {
    expect(run([look(), { t: 'leaving', nowMs: 2_000 }, { t: 'ended', ok: true }])).toEqual({ kind: 'current' })
    expect(run([look(), { t: 'leaving', nowMs: 2_000 }, look({ outdated: false })])).toEqual({ kind: 'current' })
  })

  it('a refused or failed restart is blocked with its reason, and no automatic restart is due again', () => {
    for (const reason of ['refused', 'timeout', 'no-host', 'not-back'] as const) {
      const s = run([look(), { t: 'leaving', nowMs: 2_000 }, { t: 'ended', ok: false, reason }, look({ nowMs: 99_000 })])
      expect(s).toEqual({ kind: 'outdated-blocked', reason })
      expect(hostUpdateRestartWaitMs(s, 99_000)).toBeNull()
    }
    // Refused before it ever left, too.
    expect(run([look(), { t: 'ended', ok: false, reason: 'refused' }])).toEqual({ kind: 'outdated-blocked', reason: 'refused' })
  })

  it('blocked: Restart now can still take it to restarting, and a current Host clears it', () => {
    const blocked: HostUpdateState = { kind: 'outdated-blocked', reason: 'timeout' }
    expect(run([{ t: 'leaving', nowMs: 5_000 }], blocked)).toEqual({ kind: 'restarting', since: 5_000 })
    expect(run([look({ outdated: false })], blocked)).toEqual({ kind: 'current' })
  })

  it('the banner says how many agents still run, or why the restart failed', () => {
    const view = (state: HostUpdateState) => ({ state, restartWhenIdle: true })
    expect(hostUpdateBanner(view(run([look()])))).toEqual({ key: 'status.hostUpdateWaiting', params: { n: 4 } })
    expect(hostUpdateBanner(view({ kind: 'outdated-blocked', reason: 'timeout' }))).toEqual({ key: 'status.hostRestartTimeout' })
    expect(hostUpdateBanner(view({ kind: 'restarting', since: 0 }))).toBeNull()
    expect(hostUpdateBanner(undefined)).toBeNull()
  })
})
