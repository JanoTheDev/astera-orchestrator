// W9-D: what the box's search finds: sessions, plans and Tasks, every project's, best match first. Names match by
// word, prefix, part and initials (sessionIndex.rankByFields: `trw2` finds "Trading Worker 2"). Pure.
import { rankByFields, searchSessions, type IndexedSession } from '../../../../core/orchestration/sessionIndex'
import { whereOf } from '../inbox/inboxView'

export interface PlanRef {
  jobId: string
  name: string
  projectName: string
}
export interface TaskRef {
  taskId: string
  title: string
  jobId: string
  planName: string
  projectName: string
}

export type BoxHit =
  | { kind: 'session'; key: string; title: string; where: string; sessionId: string; jobId: string; waiting: boolean }
  | { kind: 'plan'; key: string; title: string; where: string; jobId: string }
  | { kind: 'task'; key: string; title: string; where: string; jobId: string; taskId: string }
  // T30: the in-app help, found by its name and words that point to it
  | { kind: 'help'; key: string; title: string; where: string }

/** What the box needs to offer the help: its name, a line under it and the words that find it. */
export interface HelpRef {
  title: string
  where: string
  words: readonly string[]
}

/** Most results of each kind; the box is a list to pick from, not a report. */
const PER_KIND = 6

export function boxHits(src: { sessions: readonly IndexedSession[]; plans: readonly PlanRef[]; tasks: readonly TaskRef[]; help?: HelpRef }, query: string): BoxHit[] {
  const sessions = searchSessions(src.sessions, query, PER_KIND).map(
    (s): BoxHit => ({
      kind: 'session',
      key: `s:${s.sessionId}`,
      title: s.label,
      where: whereOf(s.projectName, s.planName, s.taskTitle),
      sessionId: s.sessionId,
      jobId: s.jobId,
      waiting: s.attention === 'waiting'
    })
  )
  const plans = rankByFields(src.plans, query, (p) => [p.name.toLowerCase(), p.projectName.toLowerCase()], PER_KIND).map(
    (p): BoxHit => ({ kind: 'plan', key: `p:${p.jobId}`, title: p.name, where: whereOf(p.projectName, p.name), jobId: p.jobId })
  )
  const tasks = rankByFields(src.tasks, query, (t) => [t.title.toLowerCase(), t.planName.toLowerCase(), t.projectName.toLowerCase()], PER_KIND).map(
    (t): BoxHit => ({ kind: 'task', key: `t:${t.taskId}`, title: t.title, where: whereOf(t.projectName, t.planName, t.title), jobId: t.jobId, taskId: t.taskId })
  )
  const help = src.help
    ? rankByFields([src.help], query, (h) => [h.title.toLowerCase(), ...h.words.map((w) => w.toLowerCase())], 1).map(
        (h): BoxHit => ({ kind: 'help', key: 'help', title: h.title, where: h.where })
      )
    : []
  return [...sessions, ...plans, ...tasks, ...help]
}
