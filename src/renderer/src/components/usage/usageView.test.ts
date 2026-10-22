import { describe, it, expect } from 'vitest'
import type { Account, JobTask, UsageGuardView } from '../../../../core/types'
import { stripRows } from './usageView'

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
    const rows = stripRows(view, accounts, tasks)
    expect(rows.accounts[0]).toMatchObject({ label: 'Max', paused: true, fiveHour: { percent: 93, over: true }, sevenDay: { percent: 40, resets: null, over: false } })
    expect(rows.accounts[0].fiveHour?.resets).toBe(new Date('2026-10-18T14:20:00.000Z').toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }))
    expect(rows.accounts[1]).toMatchObject({ label: 'acc_gone', paused: false, fiveHour: null })
  })

  it('live subagents per tab, named by the Task the tab works on, and the two limits', () => {
    const rows = stripRows(view, accounts, tasks)
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
    const rows = stripRows(v, null, [], now)
    expect(rows.accounts.map((a) => a.runOutInMs)).toEqual([40 * 60_000, null])
    expect(rows.pool).not.toBeNull()
  })
})
