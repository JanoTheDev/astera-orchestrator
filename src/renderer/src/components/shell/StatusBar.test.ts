// T28: the status bar's "Host update waiting" banner, its toggle and "Restart now (hand over)" (StatusBar.tsx).
// Node-only, like NotificationBell.test.ts: StatusBar is called, and its element tree is what is checked.
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { t as translate } from '../../../../core/i18n'
import type { HostStatus } from '../../../../core/types'
import { RestartProgressItem, StatusBar, type StatusBarProps } from './StatusBar'

const en = (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]): string => translate('en', k, p)
const t = en as never

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  const el = node as React.ReactElement<Record<string, unknown>>
  return [el, ...elements(el.props.children as React.ReactNode)]
}

const outdated = (over: Partial<HostStatus>): HostStatus =>
  ({ connected: true, unresponsive: false, outdated: true, hostVersion: '1.0.0', features: [], ...over }) as unknown as HostStatus
const bar = (hostStatus: HostStatus, restartHost = vi.fn()) =>
  elements(StatusBar({ t, appVersion: '1.1.0', hostStatus, hostRestarting: false, restartHost, counts: { consoles: 0, working: 0, waiting: 0 }, needsYouUnread: 0, nextQueued: null, workspaceTree: [], workspaceProjectId: null, currentProject: null, branch: null } as unknown as StatusBarProps))
const texts = (els: React.ReactElement<Record<string, unknown>>[]) => els.flatMap((el) => [el.props.children].flat()).filter((c): c is string => typeof c === 'string')

afterEach(() => vi.unstubAllGlobals())

describe('the status bar while an outdated Host waits for its restart', () => {
  it('toggle on (the default): the held restart waiting shows the banner with the count, the toggle and Restart now (hand over)', () => {
    const restartNow = vi.fn(() => Promise.resolve({ phase: 'swapping' }))
    vi.stubGlobal('window', { api: { host: { restartNow } } })
    const els = bar(
      outdated({
        restart: { phase: 'waiting', working: 3, waiting: 2, leftMs: 60_000 },
        update: { state: { kind: 'outdated-waiting', agentsRunning: 2, sessionsBlocking: 0, since: 0 }, restartWhenIdle: true }
      })
    )
    expect(texts(els)).toContain(en('status.hostUpdateWaiting', { n: 2 }))
    expect(els.some((el) => el.type === RestartProgressItem)).toBe(false)
    const button = els.find((el) => el.props.children === en('status.hostRestartNowHandOver'))
    expect(button).toBeDefined()
    expect(texts(els)).not.toContain(en('status.hostRestartAnyway'))
    expect(els.find((el) => el.props.checked === true && typeof el.props.onChange === 'function')).toBeDefined()
    ;(button!.props.onClick as () => void)()
    expect(restartNow).toHaveBeenCalledWith({ force: true })
  })

  it('toggle off: no restart under way, the banner and Restart now (hand over) ask the restart', () => {
    const restartHost = vi.fn()
    const els = bar(outdated({ update: { state: { kind: 'outdated-waiting', agentsRunning: 1, sessionsBlocking: 1, since: 0 }, restartWhenIdle: false } }), restartHost)
    expect(texts(els)).toContain(en('status.hostUpdateWaiting', { n: 2 }))
    ;(els.find((el) => el.props.children === en('status.hostRestartNowHandOver'))!.props.onClick as () => void)()
    expect(restartHost).toHaveBeenCalled()
  })

  it('once the Host is handing over, its progress shows instead', () => {
    const waitOver = outdated({ restart: { phase: 'waiting', working: 1, waiting: 1, leftMs: 0 }, update: { state: { kind: 'outdated-waiting', agentsRunning: 1, sessionsBlocking: 0, since: 0 }, restartWhenIdle: true } })
    const leaving = outdated({ restart: { phase: 'swapping' }, update: { state: { kind: 'restarting', since: 0 }, restartWhenIdle: true } })
    for (const s of [waitOver, leaving]) {
      const els = bar(s)
      expect(els.some((el) => el.type === RestartProgressItem)).toBe(true)
      expect(els.find((el) => el.props.children === en('status.hostRestartNowHandOver'))).toBeUndefined()
    }
  })
})
