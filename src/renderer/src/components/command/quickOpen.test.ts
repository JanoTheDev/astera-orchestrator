import { describe, expect, it } from 'vitest'
import type { BoxHit } from './boxHits'
import { pushRecent, quickModeOf, quickRows, rankCommands, RECENT_MAX, startsSection } from './quickOpen'

describe('quickModeOf', () => {
  it('> asks for commands, @ for tasks, anything else for the open list; the prefix is not searched', () => {
    expect(quickModeOf('>pause')).toEqual({ mode: 'commands', query: 'pause' })
    expect(quickModeOf('  > show  agents ')).toEqual({ mode: 'commands', query: 'show  agents' })
    expect(quickModeOf('@rotate')).toEqual({ mode: 'tasks', query: 'rotate' })
    expect(quickModeOf('auth')).toEqual({ mode: 'open', query: 'auth' })
    expect(quickModeOf('')).toEqual({ mode: 'open', query: '' })
  })
})

describe('quickRows', () => {
  const tabs = [
    { tabId: 'view:plan:j1', title: 'Auth rework' },
    { tabId: 'file:/g/src/auth.ts', title: 'auth.ts' }
  ]
  const hits: BoxHit[] = [
    { kind: 'session', key: 's:1', title: 'Auth Worker 1', where: 'gameful › Auth rework', sessionId: 's1', jobId: 'j1', waiting: true },
    { kind: 'plan', key: 'p:j1', title: 'Auth rework', where: 'gameful › Auth rework', jobId: 'j1' },
    { kind: 'task', key: 't:1', title: 'Rotate auth tokens', where: 'x', jobId: 'j1', taskId: 't1' },
    { kind: 'help', key: 'help', title: 'Help', where: 'Topics' }
  ]
  const files = ['src/auth.ts', 'src/lib/authState.ts']

  it('orders the sections tabs, plans, files, consoles, help', () => {
    const rows = quickRows({ tabs, hits, files }, 'auth')
    expect(rows.map((r) => r.section)).toEqual(['tab', 'tab', 'plan', 'file', 'file', 'console', 'help'])
  })
  it('does not list Tasks (they are the @ search)', () => {
    expect(quickRows({ tabs, hits, files }, 'auth').some((r) => r.key === 't:1')).toBe(false)
  })
  it('lists the open tabs, in strip order, while nothing is typed', () => {
    const rows = quickRows({ tabs, hits: [], files: [] }, '  ')
    expect(rows.map((r) => r.key)).toEqual(['tab:view:plan:j1', 'tab:file:/g/src/auth.ts'])
  })
  it('splits a file into its name and its folder', () => {
    const file = quickRows({ tabs: [], hits: [], files }, 'auth').find((r) => r.section === 'file')
    expect(file).toMatchObject({ title: 'auth.ts', where: 'src', path: 'src/auth.ts' })
  })
  it('an empty section has no row, so no label', () => {
    const rows = quickRows({ tabs: [], hits: hits.filter((h) => h.kind === 'plan'), files: [] }, 'auth')
    expect(rows.map((r) => r.section)).toEqual(['plan'])
  })
  it('startsSection marks the first row of each section', () => {
    const rows = quickRows({ tabs, hits, files }, 'auth')
    expect(rows.map((_, i) => startsSection(rows, i))).toEqual([true, false, true, true, false, true, true])
  })
})

describe('rankCommands / pushRecent', () => {
  const cmds = [{ id: 'a', t: 'view: show agents' }, { id: 'b', t: 'view: show plans' }, { id: 'c', t: 'help: show help' }]
  const fields = (c: (typeof cmds)[number]): string[] => [c.t]
  it('puts the recently used first (newest first) when nothing is typed', () => {
    expect(rankCommands(cmds, '', ['c', 'a'], fields)).toEqual({ rows: [cmds[2], cmds[0], cmds[1]], recents: 2 })
    expect(rankCommands(cmds, '', [], fields)).toEqual({ rows: cmds, recents: 0 })
  })
  it('ignores a recent id that is no command, and ranks by the query once typed', () => {
    expect(rankCommands(cmds, '', ['zz'], fields).recents).toBe(0)
    expect(rankCommands(cmds, 'plans', ['c'], fields)).toEqual({ rows: [cmds[1]], recents: 0 })
  })
  it('keeps each id once, newest first, up to RECENT_MAX', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toHaveLength(RECENT_MAX)
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')[0]).toBe('f')
  })
})
