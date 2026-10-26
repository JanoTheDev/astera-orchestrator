// The interactive half of the Discord plan workspace: buttons, select menus, modals and /plan commands
// (INTERACTION_CREATE), and the owner's messages in a plan's channel (MESSAGE_CREATE), each turned into the orch
// command the app sends for the same action. Side effects are injected (`handle` is the Host's orch.handle, `rest`
// the Discord client), so every path is tested with fakes.
//
// The trust boundary: an interaction or message is acted on only when it comes from cfg.userId; with no userId set
// nobody is. Anyone else gets an ephemeral refusal (a message, being public, gets nothing) and no command runs.
// Every interaction is answered within Discord's 3 s: anything that waits on the Host is deferred first (type 5
// or 6) and the original is edited afterwards, and a failure answers with the Host's refusal text, never a stack.
import { t, type Lang, type MessageKey } from '../../i18n'
import { awaitsApproval, type ActivityNotice } from '../../orchestration/activity'
import { jobNameOf } from '../../orchestration/jobName'
import type { OrchState } from '../../orchestration/state'
import type { Gate } from '../../orchestration/types'
import type { DiscordConfig } from '../config'
import { DISCORD_TEXT_MAX } from '../format'
import { DiscordApiError, type DiscordRest, type MessageBody } from '../rest'
import { cut, gateMessage, noticeText, planCard, planStateOf, planStateText } from './cards'
import { parsePlanCommand, planCommands } from './commands'
import { customId, parseCustomId } from './ids'

/** The Host's orchestration command handler (orch.handle). */
export type Handle = (cmd: string, args: Record<string, unknown>) => Promise<{ status: number; body: unknown }>

export type WorkspaceRest = Pick<
  DiscordRest,
  'postMessage' | 'editMessage' | 'pinMessage' | 'interactionCallback' | 'editOriginalInteraction' | 'bulkOverwriteGuildCommands'
>

export interface WorkspaceDeps {
  rest: WorkspaceRest
  handle: Handle
  state: () => OrchState
  /** Read on every event, so a changed owner applies at once. */
  cfg: () => Pick<DiscordConfig, 'userId' | 'guildId'>
  lang: () => Lang
  channelOfPlan: (jobId: string) => string | null
  /** The plan whose channel this is (not a thread in it), or null. */
  planOfChannel: (channelId: string) => string | null
  /** The id of the project whose category holds this channel, or null. */
  projectOfChannel: (channelId: string) => string | null
  log: (line: string) => void
  /** A plan changed through Discord: its card wants refreshing. */
  onChanged?: (jobId: string) => void
}

/** The owner's words `run-start` is given for an approval from Discord. */
export const APPROVE_WORDS = 'Approve & execute (Discord)'

const INTERACTION = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 } as const
const CALLBACK = { PONG: 1, MESSAGE: 4, DEFER_MESSAGE: 5, DEFER_UPDATE: 6, AUTOCOMPLETE: 8, MODAL: 9 } as const
const EPHEMERAL = 64
const TEXT_INPUT = 4
const PARAGRAPH = 2
const MODAL_TITLE_MAX = 45
/** jobs-feedback's own cap (FEEDBACK_TEXT_MAX); a Gate answer is held to the same. */
const TEXT_MAX = 4000
/** Message types a person writes: DEFAULT and REPLY. Pins, joins and the like are not talk. */
const PERSON_MESSAGE = new Set([0, 19])

const w = (lang: Lang, key: string, params?: Record<string, string | number>): string =>
  t(lang, `discord.ws.${key}` as MessageKey, params)
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

type Outcome = { ok: true; body: unknown } | { ok: false; text: string }

/** The Host's refusal as one line for the owner: its `error`, and a plan's `problems` under it. */
function refusalOf(status: number, body: unknown): string {
  const b = rec(body)
  const error = typeof b.error === 'string' ? b.error : `status ${status}`
  const problems = Array.isArray(b.problems) ? b.problems.map((p) => `\n• ${String(p)}`).join('') : ''
  return `${error}${problems}`
}

async function run(deps: WorkspaceDeps, cmd: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const r = await deps.handle(cmd, args)
    return r.status < 400 ? { ok: true, body: r.body } : { ok: false, text: refusalOf(r.status, r.body) }
  } catch (e) {
    // the error's message may carry a path or a stack: it goes to the log, never to Discord
    deps.log(`discord workspace: ${cmd} threw: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, text: w(deps.lang(), 'noAnswer') }
  }
}

const failed = (lang: Lang, text: string): string => cut(w(lang, 'failed', { error: text }), DISCORD_TEXT_MAX)

/** What jobs-feedback did, read off its body as the app's feedbackOutcomeOf (planTalk.ts) reads it: queued for the
 *  next replan, a finished plan reopened by a completion replan, or typed to the planner. */
function feedbackOutcome(body: unknown): 'sent' | 'queued' | 'reopened' {
  const b = rec(body)
  if (b.via === 'queued') return 'queued'
  return b.via === undefined && b.mode === 'completion' ? 'reopened' : 'sent'
}

/** The text of the modal's one text input, wherever Discord nests it. */
function modalText(data: Record<string, unknown>): string | null {
  const stack: unknown[] = [data]
  while (stack.length > 0) {
    const c = rec(stack.pop())
    if (c.custom_id === 'text' && typeof c.value === 'string') return c.value.trim() === '' ? null : c.value.trim().slice(0, TEXT_MAX)
    if (Array.isArray(c.components)) stack.push(...c.components)
    if (c.component !== undefined) stack.push(c.component)
  }
  return null
}

const textModal = (id: string, title: string, label: string): { type: number; data: Record<string, unknown> } => ({
  type: CALLBACK.MODAL,
  data: {
    custom_id: id,
    title: cut(title, MODAL_TITLE_MAX),
    components: [
      { type: 1, components: [{ type: TEXT_INPUT, custom_id: 'text', style: PARAGRAPH, label: cut(label, MODAL_TITLE_MAX), required: true, max_length: TEXT_MAX }] }
    ]
  }
})

/** The plan a Gate belongs to: its Run's Job. */
const planOfGate = (s: OrchState, gate: Gate): string | null => s.runs.find((r) => r.id === gate.runId)?.jobId ?? null

/** One INTERACTION_CREATE. Never throws: what fails is logged. */
export async function handleInteraction(data: unknown, deps: WorkspaceDeps): Promise<void> {
  const i = rec(data)
  const id = str(i.id)
  const token = str(i.token)
  const appId = str(i.application_id)
  // without these there is nothing to answer with
  if (!id || !token || !appId) return
  const lang = deps.lang()
  const type = i.type
  const d = rec(i.data)
  const channelId = str(i.channel_id) ?? ''
  const { rest } = deps
  const say = (content: string, ephemeral = true) =>
    rest.interactionCallback(id, token, { type: CALLBACK.MESSAGE, data: { content: cut(content, DISCORD_TEXT_MAX), ...(ephemeral ? { flags: EPHEMERAL } : {}) } })
  const defer = (update: boolean) => rest.interactionCallback(id, token, update ? { type: CALLBACK.DEFER_UPDATE } : { type: CALLBACK.DEFER_MESSAGE })
  const finish = async (msg: MessageBody): Promise<void> => {
    await rest.editOriginalInteraction(appId, token, msg)
  }

  try {
    if (type === INTERACTION.PING) return await rest.interactionCallback(id, token, { type: CALLBACK.PONG })
    const owner = deps.cfg().userId
    const userId = str(rec(rec(i.member).user).id) ?? str(rec(i.user).id)
    if (!owner || userId !== owner) return await say(w(lang, 'owner'))

    if (type === INTERACTION.AUTOCOMPLETE) return await rest.interactionCallback(id, token, { type: CALLBACK.AUTOCOMPLETE, data: { choices: [] } })

    // ── slash commands ──
    if (type === INTERACTION.COMMAND) {
      const cmd = parsePlanCommand(d)
      if (!cmd) return await say(w(lang, 'unknown'))
      // read from state alone, so it answers at once
      if (cmd.kind === 'status') return await rest.interactionCallback(id, token, { type: CALLBACK.MESSAGE, data: { ...statusText(deps, channelId, lang) } })
      if (cmd.kind === 'approve') {
        const jobId = deps.planOfChannel(channelId)
        if (!jobId) return await say(w(lang, 'noPlan'))
        await defer(false)
        return await finish({ content: await approve(deps, jobId, lang) })
      }
      const projectId = cmd.project ?? deps.projectOfChannel(channelId)
      const want = projectId?.toLowerCase()
      const project = deps.state().projects.find((p) => p.id === projectId || p.name.toLowerCase() === want)
      if (!project) return await say(w(lang, 'new.noProject'))
      await defer(false)
      return await finish({ content: await createPlan(deps, project.path, cmd.objective, lang) })
    }

    const target = parseCustomId(d.custom_id)
    // ── buttons and select menus ──
    if (type === INTERACTION.COMPONENT && target) {
      if (target.action === 'approve') {
        await defer(false)
        return await finish({ content: await approve(deps, target.id, lang) })
      }
      if (target.action === 'gate-other') return await rest.interactionCallback(id, token, textModal(customId(target), w(lang, 'modal.answer'), w(lang, 'modal.message')))
      if (target.action === 'feedback') return await rest.interactionCallback(id, token, textModal(customId(target), w(lang, 'card.talk'), w(lang, 'modal.message')))
      // a select menu's option index is its value; a button's is in its custom_id
      const values = Array.isArray(d.values) ? d.values : null
      await defer(true)
      return await finish(await answerGate(deps, target.id, { option: values ? Number(values[0]) : target.n }, lang))
    }

    // ── modal submits ──
    if (type === INTERACTION.MODAL_SUBMIT && target && (target.action === 'gate-other' || target.action === 'feedback')) {
      const text = modalText(d)
      if (text === null) return await say(w(lang, 'unknown'))
      if (target.action === 'gate-other') {
        await defer(true)
        return await finish(await answerGate(deps, target.id, { text }, lang))
      }
      await defer(false)
      return await finish({ content: await feedback(deps, target.id, text, lang) })
    }

    await say(w(lang, 'unknown'))
  } catch (e) {
    // a Discord call failed (a DiscordApiError's message is only its status and code)
    deps.log(`discord workspace: an interaction failed: ${e instanceof DiscordApiError ? e.message : e instanceof Error ? e.name : 'error'}`)
  }
}

function statusText(deps: WorkspaceDeps, channelId: string, lang: Lang): MessageBody {
  const s = deps.state()
  const jobId = deps.planOfChannel(channelId)
  if (jobId) return planCard(s, jobId, lang) ?? { content: w(lang, 'status.none') }
  const open = s.jobs.filter((j) => j.archivedAt === undefined)
  if (open.length === 0) return { content: w(lang, 'status.none') }
  const lines = open.map((j) => `• **${cut(jobNameOf(j), 100)}** · ${planStateText(planStateOf(s, j), lang)}`)
  return { content: cut(`**${w(lang, 'status.title')}**\n${lines.join('\n')}`, DISCORD_TEXT_MAX) }
}

async function approve(deps: WorkspaceDeps, jobId: string, lang: Lang): Promise<string> {
  // the app offers Approve & execute only on a plan waiting for it; run-start on any other Job restarts its coordinator
  if (!awaitsApproval(deps.state().jobs.find((j) => j.id === jobId))) return w(lang, 'notAwaiting')
  const r = await run(deps, 'run-start', { run: jobId, ownerSaid: APPROVE_WORDS })
  if (!r.ok) return failed(lang, r.text)
  deps.onChanged?.(jobId)
  return w(lang, 'approved')
}

async function answerGate(deps: WorkspaceDeps, gateId: string, answer: { option: number } | { text: string }, lang: Lang): Promise<MessageBody> {
  const s = deps.state()
  const gate = s.gates.find((g) => g.id === gateId)
  if (!gate) return { content: w(lang, 'gate.gone'), embeds: [], components: [] }
  if (gate.status !== 'open') return gateMessage(gate, lang)
  const resolution = 'text' in answer ? answer.text : gate.options?.[answer.option]
  if (resolution === undefined) return { content: w(lang, 'gate.gone') }
  const r = await run(deps, 'gate-resolve', { id: gate.id, resolution })
  // a refusal keeps the question and its buttons: only the line above them says what went wrong
  if (!r.ok) return { content: failed(lang, r.text) }
  const jobId = planOfGate(s, gate)
  if (jobId) deps.onChanged?.(jobId)
  return { content: '', ...gateMessage({ ...gate, status: 'resolved', resolution }, lang) }
}

async function feedback(deps: WorkspaceDeps, jobId: string, text: string, lang: Lang): Promise<string> {
  const r = await run(deps, 'jobs-feedback', { job: jobId, text })
  if (!r.ok) return failed(lang, r.text)
  deps.onChanged?.(jobId)
  return w(lang, `feedback.${feedbackOutcome(r.body)}`)
}

/** The app's way to start a plan from a typed objective (command/execute.ts): jobs-create, then its planner with
 *  jobs-plan; a Job whose planner did not start is removed again (run-delete, jobActions.ts discardMadeJob). */
async function createPlan(deps: WorkspaceDeps, cwd: string, objective: string, lang: Lang): Promise<string> {
  const made = await run(deps, 'jobs-create', { cwd, objective })
  if (!made.ok) return failed(lang, made.text)
  const jobId = str(rec(made.body).id)
  if (!jobId) return failed(lang, 'jobs-create gave no id')
  const planned = await run(deps, 'jobs-plan', { id: jobId })
  if (!planned.ok) {
    const removed = await run(deps, 'run-delete', { id: jobId })
    if (!removed.ok) deps.log(`discord workspace: run-delete of the half-made Job ${jobId} failed`)
    return failed(lang, planned.text)
  }
  const job = deps.state().jobs.find((j) => j.id === jobId)
  return w(lang, 'new.made', { name: cut(job ? jobNameOf(job) : objective, 200) })
}

/** A MESSAGE_CREATE: in a plan's channel (not a thread in it) the owner's message is feedback to that plan's
 *  planner, and the bot says what became of it. True when the message was a plan channel's. Never throws. */
export async function handlePlanMessage(message: unknown, deps: WorkspaceDeps): Promise<boolean> {
  const m = rec(message)
  const channelId = str(m.channel_id)
  const jobId = channelId ? deps.planOfChannel(channelId) : null
  if (!channelId || !jobId) return false
  const author = rec(m.author)
  const owner = deps.cfg().userId
  if (author.bot === true || !owner || str(author.id) !== owner) return true
  if (m.type !== undefined && !PERSON_MESSAGE.has(m.type as number)) return true
  const text = typeof m.content === 'string' ? m.content.trim() : ''
  if (text === '') return true
  const lang = deps.lang()
  try {
    await deps.rest.postMessage(channelId, { content: await feedback(deps, jobId, text, lang) })
  } catch (e) {
    deps.log(`discord workspace: a plan reply failed: ${e instanceof DiscordApiError ? e.message : 'error'}`)
  }
  return true
}

export interface PlanWorkspaceDeps extends WorkspaceDeps {
  /** The #astera channel, for activity notices. */
  homeChannel: () => string | null
  /** The card message id of each plan (jobId → message id), as last saved. */
  cards?: Record<string, string>
  /** Called with the whole map each time a card is posted anew, for the caller to persist. */
  saveCards?: (cards: Record<string, string>) => void
}

/** The plan workspace's one entry point: the Host hands it every Gateway dispatch and calls the rest as plans,
 *  Gates and notices change. */
export function planWorkspace(opts: PlanWorkspaceDeps) {
  const cards: Record<string, string> = { ...(opts.cards ?? {}) }
  /** One refresh at a time per plan, so two quick refreshes cannot post two cards. */
  const queue = new Map<string, Promise<void>>()
  const deps: WorkspaceDeps = { ...opts, onChanged: (jobId) => void refreshCard(jobId) }
  const { rest, log } = opts
  const safe = (what: string) => (e: unknown) => log(`discord workspace: ${what} failed: ${e instanceof DiscordApiError ? e.message : 'error'}`)

  async function refreshOnce(jobId: string): Promise<void> {
    const channel = opts.channelOfPlan(jobId)
    const body = channel ? planCard(opts.state(), jobId, opts.lang()) : null
    if (!channel || !body) return
    const known = cards[jobId]
    if (known) {
      try {
        await rest.editMessage(channel, known, body)
        return
      } catch (e) {
        // the card (or its channel) was deleted: post a new one; anything else is not a reason to post twice
        if (!(e instanceof DiscordApiError && e.status === 404)) throw e
      }
    }
    const posted = await rest.postMessage(channel, body)
    cards[jobId] = posted.id
    opts.saveCards?.({ ...cards })
    await rest.pinMessage(channel, posted.id).catch(safe('pinning a plan card'))
  }

  function refreshCard(jobId: string): Promise<void> {
    const next = (queue.get(jobId) ?? Promise.resolve()).then(() => refreshOnce(jobId)).catch(safe('a plan card'))
    queue.set(jobId, next)
    void next.then(() => {
      if (queue.get(jobId) === next) queue.delete(jobId)
    })
    return next
  }

  async function postGate(gate: Gate): Promise<void> {
    const jobId = planOfGate(opts.state(), gate)
    const channel = jobId ? opts.channelOfPlan(jobId) : null
    if (channel) await rest.postMessage(channel, gateMessage(gate, opts.lang())).catch(safe('posting a Gate'))
  }

  async function postNotice(n: Pick<ActivityNotice, 'title' | 'body'>): Promise<void> {
    const channel = opts.homeChannel()
    if (channel) await rest.postMessage(channel, { content: noticeText(n) }).catch(safe('posting a notice'))
  }

  async function registerCommands(appId: string): Promise<void> {
    const guildId = opts.cfg().guildId
    if (guildId) await rest.bulkOverwriteGuildCommands(appId, guildId, planCommands(opts.state().projects, opts.lang())).catch(safe('registering /plan'))
  }

  /** A Gateway dispatch. True when it was the workspace's (an interaction, or a message in a plan's channel), so the
   *  caller does not hand it on; READY is everyone's and only registers the commands here. */
  function onDispatch(type: string, data: unknown): boolean {
    if (type === 'READY') {
      const appId = str(rec(rec(data).application).id)
      if (appId) void registerCommands(appId)
      return false
    }
    if (type === 'INTERACTION_CREATE') {
      void handleInteraction(data, deps)
      return true
    }
    if (type === 'MESSAGE_CREATE') {
      const channelId = str(rec(data).channel_id)
      if (!channelId || !opts.planOfChannel(channelId)) return false
      void handlePlanMessage(data, deps)
      return true
    }
    return false
  }

  return { refreshCard, postGate, postNotice, registerCommands, onDispatch, cards: () => ({ ...cards }) }
}

export type PlanWorkspace = ReturnType<typeof planWorkspace>
