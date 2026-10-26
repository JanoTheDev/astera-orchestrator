// The notification a `notification` plugin is handed for an event (plugin Phase 3 N10): what it is about, one sentence
// in the person's language, and how much it matters, beside the whole event. A plugin posts `title` and `body` as they
// are, so the wording is the Host's: the same in every provider, and in the language the app is set to. Pure: the
// Host passes its language and a Job's objective as its state holds it.
import { t, type Lang } from '../i18n'
import type { AsteraEvent } from '../publicContract'
import { resumeAtText } from '../notify/resumeAt'
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationLevel } from '../pluginContract'

export { NOTIFICATION_KINDS, type NotificationKind, type NotificationLevel }

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

/** Whether an event's type is one a notification is made for. */
export const isNotificationKind = (type: string): type is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(type)

/** `s` cut to `max` characters, `…` included: by code points, so an emoji is never cut in half (final review M9). */
const cut = (s: string, max: number): string => {
  const chars = Array.from(s)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A field that holds text with something in it, trimmed; undefined otherwise. */
const text = (o: unknown, key: string): string | undefined => {
  const v = isObject(o) ? o[key] : undefined
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
/** A field that holds a whole number; undefined otherwise. */
const whole = (o: unknown, key: string): number | undefined => {
  const v = isObject(o) ? o[key] : undefined
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined
}
/** The last name in a path, on either platform's separators: `proj` for `C:\work\proj\` and `/home/a/proj/`. */
const lastPart = (p: string | undefined): string | undefined => p?.split(/[\\/]+/).filter((x) => x.trim() !== '').pop()

/** The notification for `event`, or null when it is not one a notification is made for, or its payload lacks what the
 *  sentence needs (final review I1: an older Host's event, or a line read back from disk, words nothing rather than
 *  failing the delivery). Never throws. */
export function notificationOf(event: AsteraEvent, d: { lang: Lang; objectiveOf(jobId: string): string | undefined }): PluginNotification | null {
  if (!isNotificationKind(event.type)) return null
  const { lang } = d
  const payload: unknown = event.payload
  const fallback = (): string => t(lang, 'notify.fallbackTitle')
  /** A Job's title: the first line of its objective that holds something, read now; its id once it is gone or blank
   *  (final review I2). */
  const jobTitle = (jobId: string | undefined): string => {
    if (jobId === undefined) return fallback()
    const objective = d.objectiveOf(jobId)
    const line = typeof objective === 'string' ? objective.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() : undefined
    return cut(line ?? jobId, NOTIFICATION_TITLE_MAX)
  }
  /** A session's title: its own, else the last part of its folder, else Astera's. */
  const sessionTitle = (): string => {
    const s = isObject(payload) ? payload.session : undefined
    return cut(text(s, 'title') ?? lastPart(text(s, 'cwd')) ?? fallback(), NOTIFICATION_TITLE_MAX)
  }
  const jobOf = (): string | undefined => event.jobId ?? text(payload, 'jobId')
  const progress = isObject(payload) ? payload.progress : undefined

  let title: string
  let body: string
  switch (event.type) {
    case 'question.created': {
      const question = text(payload, 'question')
      if (question === undefined) return null
      title = jobTitle(event.jobId)
      body = t(lang, 'pluginNotify.questionCreated', { question: cut(question, NOTIFICATION_VALUE_MAX) })
      break
    }
    case 'run.failed': {
      const [ordinal, done, total] = [whole(payload, 'ordinal'), whole(progress, 'done'), whole(progress, 'total')]
      if (ordinal === undefined || done === undefined || total === undefined) return null
      title = jobTitle(jobOf())
      body = t(lang, 'pluginNotify.runFailed', { ordinal, done, total })
      break
    }
    case 'completion.exhausted': {
      const task = text(payload, 'title')
      if (task === undefined) return null
      title = jobTitle(event.jobId)
      body = t(lang, 'pluginNotify.completionExhausted', { task: cut(task, NOTIFICATION_VALUE_MAX) })
      break
    }
    case 'run.completed': {
      const ordinal = whole(payload, 'ordinal')
      if (ordinal === undefined) return null
      title = jobTitle(jobOf())
      body = t(lang, 'pluginNotify.runCompleted', { ordinal })
      break
    }
    case 'session.input_needed': {
      title = sessionTitle()
      const prompt = isObject(payload) ? payload.prompt : undefined
      body = t(lang, prompt === 'permission' ? 'pluginNotify.inputNeeded.permission' : prompt === 'question' ? 'pluginNotify.inputNeeded.question' : 'pluginNotify.inputNeeded')
      break
    }
    case 'session.limit_waiting': {
      title = sessionTitle()
      const retry = text(payload, 'nextRetryAt')
      const at = retry === undefined ? NaN : Date.parse(retry)
      const weekly = isObject(payload) && payload.scope === 'weekly'
      body = Number.isFinite(at) ? t(lang, 'pluginNotify.limitWaitingAt', { time: resumeAtText(at, weekly, lang) }) : t(lang, 'pluginNotify.limitWaiting')
      break
    }
    case 'session.account_switched': {
      const label = text(payload, 'accountLabel')
      if (label === undefined) return null
      title = sessionTitle()
      body = t(lang, 'pluginNotify.accountSwitched', { label: cut(label, NOTIFICATION_VALUE_MAX) })
      break
    }
  }
  return { id: event.id, kind: event.type, level: NOTIFICATION_LEVEL[event.type], title, body, occurredAt: event.occurredAt, event }
}
