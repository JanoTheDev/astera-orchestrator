import { describe, expect, it } from 'vitest'
import { startActivityNotices } from './activityNotices'
import type { ActivityEvent, ActivityNotice } from '../core/orchestration/activity'
import { DesktopNotifier, type DesktopShowRequest } from './desktopNotifier'
import { DESKTOP_NOTIFY_DEFAULTS } from '../core/notify/settings'
import { createAttentionState } from '../core/sessions/attention'

const failed = (taskId: string): ActivityEvent => ({
  id: `ev_000000000000_${taskId}`,
  sequence: 1,
  occurredAt: '2026-10-18T00:00:00.000Z',
  type: 'task.status',
  taskId,
  payload: { title: `Task ${taskId}`, status: 'failed', from: 'dispatched', category: 'failed' }
})

/** A Host whose first poll is the tail and whose second gives `events`; later polls wait on the test's stop. */
const hostWith = (events: ActivityEvent[]) => {
  let polls = 0
  let release: () => void = () => {}
  const call = async (cmd: string) => {
    if (cmd !== 'activity-poll') return { status: 200, body: null }
    polls++
    if (polls === 1) return { status: 200, body: { events: [], cursor: 'c0', gap: false } }
    if (polls === 2) return { status: 200, body: { events, cursor: 'c1', gap: false } }
    await new Promise<void>((r) => (release = r))
    return { status: 200, body: { events: [], cursor: 'c1', gap: false } }
  }
  return { call, polls: () => polls, release: () => release() }
}

const settle = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setTimeout(r, 1))
}

describe('startActivityNotices (W5-D, #43)', () => {
  it("posts to the app's Slack while the app keeps it, through the desktop's one throttle", async () => {
    const host = hostWith(['a', 'b', 'c', 'd'].map(failed))
    const desktop: ActivityNotice[] = []
    const slack: string[] = []
    const stop = startActivityNotices({
      call: host.call,
      send: (n) => desktop.push(n),
      slack: { keeps: () => true, post: (t) => slack.push(t) },
      digestMinutes: () => 30,
      log: () => {}
    })
    await settle(() => host.polls() >= 3)
    stop()
    host.release()
    // At most three a minute, the same three on both sinks
    expect(desktop.map((n) => n.body)).toEqual(['Task a', 'Task b', 'Task c'])
    expect(slack).toEqual(['*Task failed*\nTask a', '*Task failed*\nTask b', '*Task failed*\nTask c'])
  })

  it('posts nothing to Slack while the Host keeps it (the Host posts then), and needs no desktop', async () => {
    const host = hostWith([failed('a')])
    const slack: string[] = []
    const stop = startActivityNotices({ call: host.call, slack: { keeps: () => false, post: (t) => slack.push(t) }, digestMinutes: () => 30, log: () => {} })
    await settle(() => host.polls() >= 3)
    stop()
    host.release()
    expect(slack).toEqual([])
  })
})

// W7-C (#71): the dogfood saw the "Needs your decision" notice with no chime. The whole way from a polled escalation to
// the desktop's show(), with the real notifier: it must ask for the chime.
describe('startActivityNotices → DesktopNotifier (W7-C, #71)', () => {
  it('a polled task.escalated reaches show() with chime true, and with alertSound off with chime false', async () => {
    const escalated: ActivityEvent = {
      id: 'ev_000000000001_esc',
      sequence: 2,
      occurredAt: '2026-10-18T00:00:00.000Z',
      type: 'task.escalated',
      runId: 'r1',
      taskId: 'a',
      sessionId: 'ses_w',
      payload: { title: 'Price task', reason: 'EUR or USD?' }
    }
    for (const alertSound of [true, false]) {
      const host = hostWith([escalated])
      const shown: DesktopShowRequest[] = []
      const desktop = new DesktopNotifier({
        settings: { getDesktopNotify: () => ({ ...DESKTOP_NOTIFY_DEFAULTS }), getAlertSound: () => alertSound },
        isFocused: () => false,
        getSession: () => null,
        lang: () => 'en',
        show: (req) => shown.push(req),
        attention: createAttentionState()
      })
      const stop = startActivityNotices({ call: host.call, send: (n) => desktop.activity(n), digestMinutes: () => 30, log: () => {} })
      await settle(() => host.polls() >= 3)
      stop()
      host.release()
      expect(shown).toEqual([
        { event: 'orchestration', sessionId: 'ses_w', title: 'Needs your decision', body: 'Price task: EUR or USD?', chime: alertSound }
      ])
    }
  })
})
