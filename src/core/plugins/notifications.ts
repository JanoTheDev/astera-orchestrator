// The notification a `notification` plugin is handed for an event (plugin Phase 3 N10): what it is about, one sentence
// in the person's language, and how much it matters, beside the whole event. A plugin posts `title` and `body` as they
// are, so the wording is the Host's: the same in every provider, and in the language the app is set to. Pure: the
// Host passes its language and a Job's objective as its state holds it.
import { t, type Lang } from '../i18n'
import type { AsteraEvent, EventSession } from '../publicContract'
import { resumeAtText } from '../notify/resumeAt'

/** The events a notification is made for, most pressing first (N10). @astera-app/plugin-sdk exports the same list,
 *  which notifications.test.ts holds to this one. */
export const NOTIFICATION_KINDS = [
  'question.created',
  'session.input_needed',
  'run.failed',
  'completion.exhausted',
  'session.limit_waiting',
  'run.completed',
  'session.account_switched'
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** How much it matters: `action` waits on the person, `error` failed, `warning` stopped for now, `info` went on. */
export type NotificationLevel = 'action' | 'error' | 'warning' | 'info'

export const NOTIFICATION_LEVEL = {
  'question.created': 'action',
  'session.input_needed': 'action',
  'run.failed': 'error',
  'completion.exhausted': 'error',
  'session.limit_waiting': 'warning',
  'run.completed': 'info',
  'session.account_switched': 'info'
} as const satisfies Record<NotificationKind, NotificationLevel>

/** A notification older than this when its turn comes is skipped, not sent (N9): a notifier enabled the morning after
 *  does not post last night's prompts. */
export const NOTIFICATION_MAX_AGE_MS = 60 * 60_000
/** The longest title, and the longest value set into a sentence, in characters, `…` included. */
export const NOTIFICATION_TITLE_MAX = 120
export const NOTIFICATION_VALUE_MAX = 500

export interface PluginNotification {
  /** The event's id: drop one you have seen. */
  id: string
  /** The event's type. */
  kind: NotificationKind
  level: NotificationLevel
  /** What it is about: a Job's objective or a session's title. */
  title: string
  /** One sentence, in the person's language. */
  body: string
  occurredAt: string
  /** The whole event, for its ids and detail. */
  event: AsteraEvent
}

const isKind = (type: string): type is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(type)
const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
/** The last name in a path, on either platform's separators: `proj` for `C:\work\proj\` and `/home/a/proj/`. */
const lastPart = (p: string | undefined): string | undefined => p?.split(/[\\/]+/).filter((x) => x !== '').pop()

/** The notification for `event`, or null when it is not one a notification is made for. */
export function notificationOf(event: AsteraEvent, d: { lang: Lang; objectiveOf(jobId: string): string | undefined }): PluginNotification | null {
  if (!isKind(event.type)) return null
  const { lang } = d
  const value = (v: string | number): string | number => (typeof v === 'string' ? cut(v, NOTIFICATION_VALUE_MAX) : v)
  /** A Job's title: the first line of its objective, read now; its id once it is gone. */
  const jobTitle = (jobId: string | undefined): string => {
    if (jobId === undefined) return t(lang, 'notify.fallbackTitle')
    const objective = d.objectiveOf(jobId)
    return cut(objective === undefined ? jobId : (objective.split(/\r?\n/)[0] ?? ''), NOTIFICATION_TITLE_MAX)
  }
  /** A session's title: its own, else the last part of its folder, else Astera's. */
  const sessionTitle = (s: EventSession | undefined): string =>
    cut(s?.title || lastPart(s?.cwd) || t(lang, 'notify.fallbackTitle'), NOTIFICATION_TITLE_MAX)

  let title: string
  let body: string
  switch (event.type) {
    case 'question.created':
      title = jobTitle(event.jobId)
      body = t(lang, 'pluginNotify.questionCreated', { question: value(event.payload.question) })
      break
    case 'run.failed':
      title = jobTitle(event.jobId ?? event.payload.jobId)
      body = t(lang, 'pluginNotify.runFailed', { ordinal: event.payload.ordinal, done: event.payload.progress.done, total: event.payload.progress.total })
      break
    case 'completion.exhausted':
      title = jobTitle(event.jobId)
      body = t(lang, 'pluginNotify.completionExhausted', { task: value(event.payload.title) })
      break
    case 'run.completed':
      title = jobTitle(event.jobId ?? event.payload.jobId)
      body = t(lang, 'pluginNotify.runCompleted', { ordinal: event.payload.ordinal })
      break
    case 'session.input_needed': {
      title = sessionTitle(event.payload.session)
      const prompt = event.payload.prompt
      body = t(lang, prompt === 'permission' ? 'pluginNotify.inputNeeded.permission' : prompt === 'question' ? 'pluginNotify.inputNeeded.question' : 'pluginNotify.inputNeeded')
      break
    }
    case 'session.limit_waiting': {
      title = sessionTitle(event.payload.session)
      const at = event.payload.nextRetryAt === undefined ? NaN : Date.parse(event.payload.nextRetryAt)
      body = Number.isFinite(at)
        ? t(lang, 'pluginNotify.limitWaitingAt', { time: resumeAtText(at, event.payload.scope === 'weekly') })
        : t(lang, 'pluginNotify.limitWaiting')
      break
    }
    case 'session.account_switched':
      title = sessionTitle(event.payload.session)
      body = t(lang, 'pluginNotify.accountSwitched', { label: value(event.payload.accountLabel) })
      break
  }
  return { id: event.id, kind: event.type, level: NOTIFICATION_LEVEL[event.type], title, body, occurredAt: event.occurredAt, event }
}
