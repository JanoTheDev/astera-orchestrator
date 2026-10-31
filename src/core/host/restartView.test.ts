import { describe, expect, it } from 'vitest'
import type { HostRestartState, HostStatus } from '../types'
import {
  formatRestartLeft,
  handoverSessionCount,
  hostReplacementFor,
  hostRestartCanForce,
  hostRestartMessage,
  hostRestartOffered,
  hostRestartRunning
} from './restartView'

const status = (over: Partial<HostStatus> = {}): HostStatus => ({
  connected: true,
  protocol: 5,
  hostVersion: '1.4.1',
  startedAt: null,
  pid: 10,
  problem: null,
  outdated: true,
  unresponsive: false,
  runtimeIncomplete: false,
  features: ['restart'],
  ...over
})

describe('formatRestartLeft', () => {
  it('reads minutes and seconds, rounding up so the last second is not 0:00', () => {
    expect(formatRestartLeft(130_000)).toBe('2:10')
    expect(formatRestartLeft(600_000)).toBe('10:00')
    expect(formatRestartLeft(61_000)).toBe('1:01')
    expect(formatRestartLeft(1)).toBe('0:01')
    expect(formatRestartLeft(0)).toBe('0:00')
    expect(formatRestartLeft(-5)).toBe('0:00')
  })
})

describe('hostReplacementFor', () => {
  it('offers the restart at once for a connected, answering Host older than the app', () => {
    expect(hostReplacementFor(status(), null)).toBe('offered')
  })
  it('offers nothing for a current Host, one that is not connected, or one that is not answering', () => {
    expect(hostReplacementFor(status({ outdated: false }), null)).toBeNull()
    expect(hostReplacementFor(status({ connected: false }), null)).toBeNull()
    expect(hostReplacementFor(status({ unresponsive: true }), null)).toBeNull()
  })
  it('keeps a swap or a manual offer main already set', () => {
    expect(hostReplacementFor(status(), 'swapping')).toBe('swapping')
    expect(hostReplacementFor(status(), 'manual')).toBe('manual')
    expect(hostReplacementFor(status({ outdated: false }), 'swapping')).toBe('swapping')
  })
})

describe('hostRestartOffered', () => {
  it('shows for an outdated Host the moment it connects, not only after 30 minutes of waiting', () => {
    expect(hostRestartOffered(status({ replacement: 'offered' }))).toBe(true)
    expect(hostRestartOffered(status())).toBe(true)
    expect(hostRestartOffered(status({ replacement: 'manual' }))).toBe(true)
  })
  it('does not show for a current Host, no Host, or one that is not answering', () => {
    expect(hostRestartOffered(null)).toBe(false)
    expect(hostRestartOffered(status({ outdated: false }))).toBe(false)
    expect(hostRestartOffered(status({ connected: false }))).toBe(false)
    expect(hostRestartOffered(status({ unresponsive: true }))).toBe(false)
  })
  it('gives way to a swap and to a restart under way, and comes back after one failed', () => {
    expect(hostRestartOffered(status({ replacement: 'swapping' }))).toBe(false)
    expect(hostRestartOffered(status({ restart: { phase: 'waiting', working: 3, waiting: 2, leftMs: 5_000 } }))).toBe(false)
    expect(hostRestartOffered(status({ restart: { phase: 'swapping' } }))).toBe(false)
    expect(hostRestartOffered(status({ restart: { phase: 'failed', reason: 'refused', tasks: 1 } }))).toBe(true)
  })
})

describe('hostRestartRunning and hostRestartCanForce', () => {
  const waiting = (waitingOn: number, leftMs: number): HostRestartState => ({ phase: 'waiting', working: 3, waiting: waitingOn, leftMs })
  it('runs while waiting or swapping', () => {
    expect(hostRestartRunning(undefined)).toBe(false)
    expect(hostRestartRunning(waiting(1, 1_000))).toBe(true)
    expect(hostRestartRunning({ phase: 'swapping' })).toBe(true)
    expect(hostRestartRunning({ phase: 'done', from: '1', to: '2', resumed: 0 })).toBe(false)
    expect(hostRestartRunning({ phase: 'failed', reason: 'timeout' })).toBe(false)
  })
  it('offers Restart anyway only while Tasks are waited for and time is left', () => {
    expect(hostRestartCanForce(waiting(2, 130_000))).toBe(true)
    expect(hostRestartCanForce(waiting(0, 130_000))).toBe(false)
    expect(hostRestartCanForce(waiting(2, 0))).toBe(false)
    expect(hostRestartCanForce({ phase: 'swapping' })).toBe(false)
    expect(hostRestartCanForce(undefined)).toBe(false)
  })
})

describe('hostRestartMessage', () => {
  it('says how many workers are waited for and how long is left', () => {
    expect(hostRestartMessage({ phase: 'waiting', working: 5, waiting: 3, leftMs: 130_000 })).toEqual({
      key: 'status.hostRestartWaiting',
      params: { n: 3, left: '2:10' }
    })
  })
  it('says it is handing over once nobody is waited for, the wait ran out, or it was cut short', () => {
    expect(hostRestartMessage({ phase: 'waiting', working: 5, waiting: 0, leftMs: 130_000 })).toEqual({ key: 'status.hostRestartHandingOver' })
    expect(hostRestartMessage({ phase: 'waiting', working: 5, waiting: 2, leftMs: 0 })).toEqual({ key: 'status.hostRestartHandingOver' })
    expect(hostRestartMessage({ phase: 'swapping' })).toEqual({ key: 'status.hostRestartSwapping' })
  })
  it('says how many sessions were resumed', () => {
    expect(hostRestartMessage({ phase: 'done', from: '1.4.1', to: '1.4.2', resumed: 12 })).toEqual({ key: 'status.hostRestartDone', params: { n: 12 } })
  })
  it('names why nothing was restarted', () => {
    expect(hostRestartMessage({ phase: 'failed', reason: 'refused', tasks: 2 })).toEqual({ key: 'status.hostRestartRefused', params: { n: 2 } })
    expect(hostRestartMessage({ phase: 'failed', reason: 'refused' })).toEqual({ key: 'status.hostRestartRefused', params: { n: 0 } })
    expect(hostRestartMessage({ phase: 'failed', reason: 'quitting' }).key).toBe('status.hostRestartQuitting')
    expect(hostRestartMessage({ phase: 'failed', reason: 'timeout' }).key).toBe('status.hostRestartTimeout')
    expect(hostRestartMessage({ phase: 'failed', reason: 'no-host' }).key).toBe('status.hostRestartNoHost')
    expect(hostRestartMessage({ phase: 'failed', reason: 'not-back' }).key).toBe('status.hostRestartNotBack')
  })
})

describe('handoverSessionCount', () => {
  it('counts the agent sessions and the chats, not the terminals and runs', () => {
    const raw = JSON.stringify({
      sessions: [{ sessionId: 'a' }, { sessionId: 'b' }],
      chats: [{ sessionId: 'c' }],
      ptys: [{ meta: { kind: 'terminal' } }, { meta: { kind: 'run' } }]
    })
    expect(handoverSessionCount(raw)).toBe(3)
  })
  it('reads a handover an older Host wrote, with no chats', () => {
    expect(handoverSessionCount(JSON.stringify({ sessions: [{ sessionId: 'a' }], ptys: [] }))).toBe(1)
  })
  it('is 0 for anything that is not a handover', () => {
    expect(handoverSessionCount('')).toBe(0)
    expect(handoverSessionCount('not json')).toBe(0)
    expect(handoverSessionCount('null')).toBe(0)
    expect(handoverSessionCount('[]')).toBe(0)
    expect(handoverSessionCount(JSON.stringify({ sessions: 'x', chats: 4 }))).toBe(0)
  })
})
