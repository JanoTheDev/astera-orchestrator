// The plan workspace's messages as pure renderers: a plan's card, a Gate's question, an activity notice. They
// return Discord message bodies (embeds and components) and post nothing, so every limit Discord puts on a
// message is pinned by a test here. Words come from i18n (`discord.ws.*`); the notice keeps activity.ts's own.
import { t, type Lang, type MessageKey } from '../../i18n'
import { awaitsApproval, type ActivityNotice } from '../../orchestration/activity'
import { holdOf } from '../../orchestration/holds'
import { planApprovable } from '../../orchestration/exec/plannerFeedback'
import { jobNameOf } from '../../orchestration/jobName'
import { jobView, latestRunOf } from '../../orchestration/publicViews'
import { tasksOwnedBy } from '../../orchestration/running'
import type { OrchState } from '../../orchestration/state'
import type { Gate, Job } from '../../orchestration/types'
import { toDiscordText } from '../format'
import type { MessageBody } from '../rest'
import { customId } from './ids'

/** Discord's caps on one embed. `total` counts the title, description, field names and values and the footer. */
export const EMBED_LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 } as const
const BUTTON_LABEL_MAX = 80
const SELECT_LABEL_MAX = 100
const OBJECTIVE_MAX = 1000
const TASK_TITLE_MAX = 100
/** Buttons on a row, rows on a message, options on a select menu. */
const ROW_MAX = 5
const ROWS_MAX = 5
const SELECT_OPTIONS_MAX = 25
/** Up to this many options go on buttons (four rows of five); the fifth row holds "Other answer". */
const BUTTON_OPTIONS_MAX = (ROWS_MAX - 1) * ROW_MAX

const ACTION_ROW = 1
const BUTTON = 2
const STRING_SELECT = 3
const PRIMARY = 1
const SECONDARY = 2
const SUCCESS = 3

const NO_PINGS = { parse: [] }

interface Embed {
  title?: string
  description?: string
  fields?: Array<{ name: string; value: string }>
  footer?: { text: string }
}

/** The characters Discord counts against EMBED_LIMITS.total. */
export const embedSize = (e: Embed): number =>
  (e.title?.length ?? 0) +
  (e.description?.length ?? 0) +
  (e.footer?.text.length ?? 0) +
  (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)

/** `s` cut to `max` characters with an ellipsis, never splitting an emoji's surrogate pair. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s
  let out = s.slice(0, max - 1)
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  return `${out}…`
}

const w = (lang: Lang, key: string, params?: Record<string, string | number>): string =>
  t(lang, `discord.ws.${key}` as MessageKey, params)

export type PlanState =
  | 'archived'
  | 'approve'
  | 'planning'
  | 'notStarted'
  | 'pending'
  | 'running'
  | 'checking'
  | 'finalCheck'
  | 'replanning'
  | 'question'
  | 'held'
  | 'delivering'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'blocked'

const HOLD_STATE = { 'replan-question': 'question', owner: 'held', replanning: 'replanning', 'final-check': 'finalCheck' } as const

/** Where a plan stands, in the words the app uses: waiting for approval is offered only once the plan can be
 *  approved (the app's approveSlot), otherwise its planner is still at it; a hold (holdOf) and a stopped or delivering
 *  Run come before the Tasks' outcome, which would read them as running. */
export function planStateOf(s: OrchState, job: Job): PlanState {
  if (job.archivedAt !== undefined) return 'archived'
  if (awaitsApproval(job)) return planApprovable(s, job) ? 'approve' : 'planning'
  const hold = holdOf(job)
  if (hold !== undefined) return HOLD_STATE[hold]
  const run = latestRunOf(s, job)
  if (run === undefined) return job.pendingStart ? 'notStarted' : 'pending'
  if (run.paused === true) return 'stopped'
  const delivery = run.deliveryState?.state
  if (delivery === 'delivering' || delivery === 'retrying') return 'delivering'
  return jobView(s, job, run).outcome as PlanState
}

export const planStateText = (state: PlanState, lang: Lang): string => w(lang, `state.${state}`)

const row = (components: unknown[]): unknown => ({ type: ACTION_ROW, components })
const button = (label: string, id: string, style: number): unknown => ({ type: BUTTON, style, label: cut(label, BUTTON_LABEL_MAX), custom_id: id })

/** A plan's card: its name, objective, state and Tasks, with "Approve & execute" while it awaits approval and
 *  "Talk to the planner" always. Null when the plan is gone. */
export function planCard(s: OrchState, jobId: string, lang: Lang): (MessageBody & { allowed_mentions: { parse: [] } }) | null {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return null
  const state = planStateOf(s, job)
  const run = latestRunOf(s, job)
  const tasks = tasksOwnedBy(s, run?.id ?? job.id)
  const done = tasks.filter((x) => x.status === 'completed').length

  const embed: Embed = {
    title: cut(jobNameOf(job), EMBED_LIMITS.title),
    description: `${w(lang, 'card.state', { state: planStateText(state, lang) })}\n\n${cut(job.objective, OBJECTIVE_MAX)}`,
    fields: []
  }
  const lines = tasks.map((x) => `• **${w(lang, `task.${x.status}`)}** · ${cut(x.title.replace(/\s+/g, ' '), TASK_TITLE_MAX)}`)
  if (lines.length === 0) embed.fields!.push({ name: w(lang, 'card.tasks', { done, total: 0 }), value: w(lang, 'card.noTasks') })
  // Pack the lines into fields, keeping room for the footer that counts what did not fit. A line (at most
  // ~130 characters) always fits a fresh field.
  let budget = EMBED_LIMITS.total - embedSize(embed) - w(lang, 'card.more', { count: lines.length }).length
  let shown = 0
  for (const line of lines) {
    const last = embed.fields!.at(-1)
    if (last && last.value.length + 1 + line.length <= EMBED_LIMITS.fieldValue) {
      if (line.length + 1 > budget) break
      last.value += `\n${line}`
      budget -= line.length + 1
    } else {
      const name = embed.fields!.length === 0 ? w(lang, 'card.tasks', { done, total: tasks.length }) : '\u200b'
      if (embed.fields!.length >= EMBED_LIMITS.fields || name.length + line.length > budget) break
      embed.fields!.push({ name, value: line })
      budget -= name.length + line.length
    }
    shown++
  }
  if (shown < lines.length) embed.footer = { text: w(lang, 'card.more', { count: lines.length - shown }) }

  const buttons = [
    ...(state === 'approve' ? [button(w(lang, 'card.approve'), customId({ action: 'approve', id: job.id }), SUCCESS)] : []),
    button(w(lang, 'card.talk'), customId({ action: 'feedback', id: job.id }), SECONDARY)
  ]
  return { embeds: [embed], components: [row(buttons)], allowed_mentions: NO_PINGS as { parse: [] } }
}

/** A Gate's question with one button per option and "Other answer" (opens a modal). Over BUTTON_OPTIONS_MAX
 *  options go on select menus of 25 instead. A resolved Gate shows its answer and no components. */
export function gateMessage(gate: Gate, lang: Lang): MessageBody & { allowed_mentions: { parse: [] } } {
  const embed: Embed = { title: w(lang, 'gate.title'), description: cut(gate.question, EMBED_LIMITS.description - 300) }
  if (gate.status === 'resolved') {
    embed.footer = { text: cut(w(lang, 'gate.answered', { answer: gate.resolution ?? '' }), 280) }
    return { embeds: [embed], components: [], allowed_mentions: NO_PINGS as { parse: [] } }
  }
  const options = gate.options ?? []
  const rows: unknown[] = []
  if (options.length <= BUTTON_OPTIONS_MAX) {
    for (let i = 0; i < options.length; i += ROW_MAX)
      rows.push(row(options.slice(i, i + ROW_MAX).map((o, k) => button(o, customId({ action: 'gate', id: gate.id, n: i + k }), PRIMARY))))
  } else {
    // shortcut: past 4 menus × 25 = 100 options the rest are not offered (Other answer still is); page them if a Gate ever has more
    for (let menu = 0; menu < ROWS_MAX - 1 && menu * SELECT_OPTIONS_MAX < options.length; menu++) {
      const from = menu * SELECT_OPTIONS_MAX
      rows.push(
        row([
          {
            type: STRING_SELECT,
            custom_id: customId({ action: 'gate', id: gate.id, n: menu }),
            placeholder: w(lang, 'gate.pick'),
            options: options.slice(from, from + SELECT_OPTIONS_MAX).map((o, k) => ({ label: cut(o, SELECT_LABEL_MAX), value: String(from + k) }))
          }
        ])
      )
    }
  }
  rows.push(row([button(w(lang, 'gate.other'), customId({ action: 'gate-other', id: gate.id }), SECONDARY)]))
  return { embeds: [embed], components: rows, allowed_mentions: NO_PINGS as { parse: [] } }
}

/** An activity notice for #astera, worded as activity.ts words it (the Host's other connections post the same). */
export const noticeText = (n: Pick<ActivityNotice, 'title' | 'body'>): string => toDiscordText(`*${n.title}*\n${n.body}`)
