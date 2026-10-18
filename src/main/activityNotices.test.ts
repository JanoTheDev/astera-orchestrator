import { describe, expect, it } from 'vitest'
import { startActivityNotices } from './activityNotices'
import type { ActivityEvent, ActivityNotice } from '../core/orchestration/activity'

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
