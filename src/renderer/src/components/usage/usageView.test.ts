import { describe, it, expect } from 'vitest'
import type { Account, AccountPlan, JobTask, UsageGuardView } from '../../../../core/types'
import { stripRows } from './usageView'
import { resetClock } from '../../../../core/orchestration/activity'

describe('stripRows', () => {
  const view: UsageGuardView = {
    pauseAt: 90,
    maxSubagents: 10,
    accounts: [
      {
        accountId: 'acc_max',
        session: { usedPercent: 93, resetsAt: '2026-10-18T14:20:00.000Z' },
        weekly: { usedPercent: 40, resetsAt: null },
        paused: { accountId: 'acc_max', window: 'five_hour', percent: 93, resetsAt: '2026-10-18T14:20:00.000Z' }
      },
      { accountId: 'acc_gone', session: null, weekly: { usedPercent: 10, resetsAt: null }, paused: null }
    ],
    subagents: [
      { sessionId: 'ses_worker_1234', count: 3 },
      { sessionId: 'ses_plain_abcdef', count: 1 }
    ]
  }
  const accounts = [{ id: 'acc_max', label: 'Max' }] as Account[]
  const tasks = [{ id: 't1', title: 'Build API', sessionId: 'ses_worker_1234' }] as JobTask[]

  it('per account: its name, both windows with the reset time, and whether new workers are paused', () => {
    const rows = stripRows(view, accounts, tasks, {})
    expect(rows.accounts[0]).toMatchObject({ label: 'Max', paused: true, fiveHour: { percent: 93, over: true }, sevenDay: { percent: 40, resets: null, over: false } })
    expect(rows.accounts[0].fiveHour?.resets).toBe(new Date('2026-10-18T14:20:00.000Z').toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }))
    expect(rows.accounts[1]).toMatchObject({ label: 'acc_gone', paused: false, fiveHour: null })
  })

  it('live subagents per tab, named by the Task the tab works on, and the two limits', () => {
    const rows = stripRows(view, accounts, tasks, {})
    expect(rows.subagents).toEqual([
      { sessionId: 'ses_worker_1234', label: 'Build API', count: 3 },
      { sessionId: 'ses_plain_abcdef', label: 'ses_plai', count: 1 }
    ])
    expect(rows.pauseAt).toBe(90)
    expect(rows.maxSubagents).toBe(10)
  })

  it('run-out: per account only when not paused or over, and one pool figure', () => {
    const now = Date.parse('2026-10-18T10:00:00.000Z')
    const at = (ageMs: number): string => new Date(now - ageMs + 5 * 3_600_000).toISOString()
    const v: UsageGuardView = {
      pauseAt: 90,
      maxSubagents: 10,
      accounts: [
        { accountId: 'a', session: { usedPercent: 60, resetsAt: at(3_600_000) }, weekly: null, paused: null },
        { accountId: 'b', session: { usedPercent: 95, resetsAt: at(3_600_000) }, weekly: null, paused: null }
      ],
      subagents: []
    }
    const rows = stripRows(v, null, [], {}, now)
    expect(rows.accounts.map((a) => a.runOutInMs)).toEqual([40 * 60_000, null])
    expect(rows.pool).not.toBeNull()
  })
})

describe('stripRows room', () => {
  const now = Date.parse('2026-10-18T10:00:00.000Z')
  const future = '2026-10-18T14:20:00.000Z'
  const later = '2026-10-19T09:00:00.000Z'
  const free = { usedPercent: 10, resetsAt: null }
  const full = (resetsAt: string | null = future) => ({ usedPercent: 95, resetsAt })
  const accountsOf = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' }
  ] as Account[]
  const rowOf = (accountId: string, session: { usedPercent: number; resetsAt: string | null } | null, weekly: { usedPercent: number; resetsAt: string | null } | null, paused = false): UsageGuardView['accounts'][number] => ({
    accountId,
    session,
    weekly,
    paused: paused ? { accountId, window: 'five_hour', percent: 95, resetsAt: future } : null
  })
  const viewOf = (accounts: UsageGuardView['accounts']): UsageGuardView => ({ pauseAt: 90, maxSubagents: 10, accounts, subagents: [] })

  it('one account with room is named when the others are over the threshold', () => {
    const v = viewOf([rowOf('a', null, full()), rowOf('b', null, full()), rowOf('c', free, free)])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'one', accountId: 'c', label: 'Gamma' })
  })

  it('one account with room is named when the others are paused', () => {
    const v = viewOf([rowOf('a', free, free, true), rowOf('b', free, free), rowOf('c', free, free, true)])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'one', accountId: 'b', label: 'Beta' })
  })

  it('no account with room gives none, resuming at the soonest full reset', () => {
    const v = viewOf([rowOf('a', full(later), null), rowOf('b', full(future), null), rowOf('c', null, full(later))])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'none', resumes: resetClock(future, false) })
  })

  it('no account with room and no known reset gives none with no time', () => {
    const v = viewOf([rowOf('a', full(null), null), rowOf('b', null, full(null))])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'none', resumes: null })
  })

  it('a paused account counts as no room, even with both windows under the threshold', () => {
    const v = viewOf([rowOf('a', free, free, true), rowOf('b', full(later), null)])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'none', resumes: resetClock(later, false) })
  })

  it('a full window whose reset has passed counts as room', () => {
    const passed = '2026-10-18T09:00:00.000Z'
    const v = viewOf([rowOf('a', null, full(passed)), rowOf('b', full(later), null)])
    expect(stripRows(v, accountsOf, [], {}, now).room).toEqual({ kind: 'one', accountId: 'a', label: 'Alpha' })
  })

  it('two or more accounts with room give null', () => {
    const v = viewOf([rowOf('a', null, full()), rowOf('b', free, free), rowOf('c', free, free)])
    expect(stripRows(v, accountsOf, [], {}, now).room).toBeNull()
  })

  it('a single account gives null', () => {
    const v = viewOf([rowOf('a', null, full())])
    expect(stripRows(v, [accountsOf[0]], [], {}, now).room).toBeNull()
  })
})

describe('stripRows 5-hour window by plan', () => {
  const view: UsageGuardView = {
    pauseAt: 90,
    maxSubagents: 10,
    accounts: [{ accountId: 'acc_ultra', session: { usedPercent: 12, resetsAt: null }, weekly: { usedPercent: 40, resetsAt: null }, paused: null }],
    subagents: []
  }
  const accounts = [{ id: 'acc_ultra', label: 'Ultra' }] as Account[]
  const ultra = { id: 'ultra', raw: 'ultra', hasSessionWindow: false } as AccountPlan
  const max = { id: 'max', raw: 'max', hasSessionWindow: true } as AccountPlan

  it('an Ultra account draws no 5-hour window, even when its reading carries one; the weekly window stays', () => {
    const rows = stripRows(view, accounts, [], { acc_ultra: ultra })
    expect(rows.accounts[0].fiveHour).toBeNull()
    expect(rows.accounts[0].sevenDay).toMatchObject({ percent: 40 })
  })

  it('an account whose plan is not known yet keeps its 5-hour window', () => {
    expect(stripRows(view, accounts, [], {}).accounts[0].fiveHour).toMatchObject({ percent: 12 })
  })

  it('an account whose plan has a 5-hour window keeps it', () => {
    expect(stripRows(view, accounts, [], { acc_ultra: max }).accounts[0].fiveHour).toMatchObject({ percent: 12 })
  })
})
