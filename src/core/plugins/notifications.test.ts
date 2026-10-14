// The notification a `notification` plugin is handed (plugin Phase 3 N10): each kind's level, title and sentence, in
// every language the app speaks, with the Job's or the session's title, cut where a value is long.
import { describe, it, expect } from 'vitest'
import { LANGS, t, type Lang } from '../i18n'
import type { AsteraEvent } from '../publicContract'
import { resumeAtText } from '../notify/resumeAt'
import { NOTIFICATION_KINDS, NOTIFICATION_LEVEL, notificationOf } from './notifications'

const objectives: Record<string, string> = { job_1: 'Ship the release\nwith notes' }
const word = (e: unknown, lang: Lang = 'en') => notificationOf(e as AsteraEvent, { lang, objectiveOf: (id) => objectives[id] })
const ev = (type: string, payload: unknown, ids: Record<string, string> = { jobId: 'job_1' }) => ({
  id: 'ev_aaaaaaaaaaaa_1',
  type,
  sequence: 1,
  occurredAt: '2026-10-14T00:00:00.000Z',
  ...ids,
  payload
})
const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 2, progress: { done: 3, total: 5 } }
const session = { id: 's1', kind: 'terminal', title: 'Fix the build', cwd: '/w/proj' }
const AT = Date.parse('2026-10-14T05:30:00.000Z')

/** One event of each kind, in NOTIFICATION_KINDS' order. */
const samples = () => [
  ev('question.created', { question: 'Which branch?' }),
  ev('session.input_needed', { session, prompt: 'permission' }, { sessionId: 's1' }),
  ev('run.failed', RUN),
  ev('completion.exhausted', { taskId: 't1', title: 'Add tests' }),
  ev('session.limit_waiting', { session, scope: 'session', nextRetryAt: new Date(AT).toISOString() }, { sessionId: 's1' }),
  ev('run.completed', RUN),
  ev('session.account_switched', { session, accountLabel: 'work' }, { sessionId: 's1' })
]

describe('notificationOf (plugin Phase 3 N10)', () => {
  it('words each kind with its level and the Job’s or the session’s title', () => {
    expect(word(ev('question.created', { question: 'Which branch?' }))).toMatchObject({
      kind: 'question.created',
      level: 'action',
      title: 'Ship the release',
      body: 'Waiting for an answer: Which branch?'
    })
    expect(word(ev('run.failed', RUN))).toMatchObject({ level: 'error', title: 'Ship the release', body: 'Run 2 failed (3 of 5 Tasks done).' })
    expect(word(ev('completion.exhausted', { taskId: 't1', title: 'Add tests' }))).toMatchObject({
      level: 'error',
      body: 'The completion checks of Add tests used every repair.'
    })
    expect(word(ev('run.completed', RUN))).toMatchObject({ level: 'info', body: 'Run 2 finished.' })
    expect(word(ev('session.input_needed', { session, prompt: 'permission' }, { sessionId: 's1' }))).toMatchObject({
      level: 'action',
      title: 'Fix the build',
      body: 'Waiting for permission.'
    })
    expect(word(ev('session.input_needed', { session, prompt: 'question' }, { sessionId: 's1' }))!.body).toBe('Waiting for an answer to a question.')
    expect(word(ev('session.input_needed', { session, prompt: null }, { sessionId: 's1' }))!.body).toBe('Waiting for input.')
    expect(word(ev('session.limit_waiting', { session, scope: 'session', nextRetryAt: new Date(AT).toISOString() }, { sessionId: 's1' }))).toMatchObject({
      level: 'warning',
      body: `Stopped at a usage limit; trying again at ${resumeAtText(AT, false)}.`
    })
    expect(word(ev('session.limit_waiting', { session, scope: 'weekly', nextRetryAt: new Date(AT).toISOString() }, { sessionId: 's1' }))!.body).toBe(
      `Stopped at a usage limit; trying again at ${resumeAtText(AT, true)}.`
    )
    expect(word(ev('session.limit_waiting', { session }, { sessionId: 's1' }))!.body).toBe('Stopped at a usage limit.')
    expect(word(ev('session.limit_waiting', { session, nextRetryAt: 'soon' }, { sessionId: 's1' }))!.body).toBe('Stopped at a usage limit.')
    expect(word(ev('session.account_switched', { session, accountLabel: 'work' }, { sessionId: 's1' }))).toMatchObject({
      level: 'info',
      body: 'Continuing on the work account.'
    })
  })

  it('carries the event whole, its id and its time, and words nothing else', () => {
    const e = ev('run.completed', RUN)
    expect(word(e)).toMatchObject({ id: e.id, occurredAt: e.occurredAt, event: e })
    expect(word(ev('job.created', {}))).toBeNull()
    expect(word({ type: 'gap' })).toBeNull()
  })

  it('words every kind in every language, each at its level, with nothing left in braces', () => {
    expect(samples().map((e) => word(e)!.kind)).toEqual([...NOTIFICATION_KINDS])
    for (const lang of LANGS)
      for (const n of samples().map((e) => word(e, lang)!)) {
        expect(n.level, `${lang} ${n.kind}`).toBe(NOTIFICATION_LEVEL[n.kind])
        expect(n.body, `${lang} ${n.kind}`).not.toMatch(/\{\w+\}/)
        expect(n.body.length, `${lang} ${n.kind}`).toBeGreaterThan(0)
      }
    expect(word(ev('run.completed', RUN), 'ko')!.body).toBe(t('ko', 'pluginNotify.runCompleted', { ordinal: 2 }))
    expect(word(ev('run.completed', RUN), 'ko')!.body).not.toBe(word(ev('run.completed', RUN), 'en')!.body)
  })

  // Review Focus 3, 4
  it('titles a gone Job by its id, and an untitled session by the last part of its folder', () => {
    expect(word(ev('run.completed', RUN, { jobId: 'job_gone' }))!.title).toBe('job_gone')
    expect(word(ev('run.completed', { ...RUN, jobId: 'job_payload' }, {}))!.title).toBe('job_payload')
    for (const cwd of ['C:\\work\\proj\\', '/home/a/proj/', '/home/a/proj'])
      expect(word(ev('session.input_needed', { session: { id: 's', kind: 'terminal', cwd }, prompt: null }, { sessionId: 's' }))!.title, cwd).toBe('proj')
    expect(word(ev('session.input_needed', { session: { id: 's', kind: 'chat' }, prompt: null }, { sessionId: 's' }))!.title).toBe('Astera')
    expect(word(ev('question.created', { question: 'q' }, {}))!.title).toBe('Astera')
  })

  // Review Focus 5
  it('cuts a value at 500 characters and a title at 120, with …', () => {
    objectives.job_long = `${'o'.repeat(300)}\nsecond line`
    const n = word(ev('question.created', { question: 'q'.repeat(10_000) }, { jobId: 'job_long' }))!
    expect(n.title).toBe(`${'o'.repeat(119)}…`)
    expect(n.body).toBe(`Waiting for an answer: ${'q'.repeat(499)}…`)
    const s = word(ev('session.input_needed', { session: { id: 's', kind: 'terminal', title: 't'.repeat(200) }, prompt: null }, { sessionId: 's' }))!
    expect(s.title).toBe(`${'t'.repeat(119)}…`)
  })
})

describe('resumeAtText', () => {
  it('says the hour and minute for a session limit, and the day too for a weekly one', () => {
    expect(resumeAtText(AT, false)).toMatch(/^\d\d:\d\d$/)
    expect(resumeAtText(AT, true)).toMatch(/^\d{1,2}\/\d{1,2} \d\d:\d\d$/)
    const d = new Date(AT)
    expect(resumeAtText(AT, true)).toBe(`${d.getMonth() + 1}/${d.getDate()} ${resumeAtText(AT, false)}`)
  })
})
