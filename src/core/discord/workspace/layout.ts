// The Discord server's layout as Astera's plans want it, and the steps that take the server there. Both are pure:
// desiredLayout reads the orchestration state, reconcile compares it with the guild's channels and the store of ids
// the bot created, and apply.ts runs the steps. Only channels named in the store are ever edited, moved or deleted.
import { basename } from 'node:path'
import { awaitsApproval } from '../../orchestration/activity'
import { holdOf } from '../../orchestration/holds'
import { jobNameOf } from '../../orchestration/jobName'
import { isJobActive } from '../../orchestration/lifecycle'
import { projectOfJob } from '../../orchestration/projects'
import type { OrchState } from '../../orchestration/state'
import type { Job } from '../../orchestration/types'
import { CHANNEL_NAME_MAX, channelSlug } from '../format'
import type { DiscordChannel } from '../rest'
import { ChannelType } from '../rest'
import { emptyWorkspaceStore, slotId, type Slot, type WorkspaceStore } from './store'

export const ASTERA_CATEGORY = 'Astera'
export const ARCHIVE_CATEGORY = 'Astera archive'
export const CONTROL_CHANNEL = 'astera'
/** The session-connection Task finds this channel by name under ASTERA_CATEGORY: keep the two in step. */
export const SESSIONS_CHANNEL = 'sessions'
/** Discord allows 500 channels in a guild; the bot leaves room for the owner's own. */
export const GUILD_CHANNEL_CAP = 480
/** Discord allows 50 channels in a category. */
export const ARCHIVE_CAP = 50

export interface DesiredPlan {
  jobId: string
  name: string
  topic: string
}
export interface DesiredProject {
  id: string
  name: string
  /** In channel order: plans needing the owner first, then running ones, then the rest. */
  plans: DesiredPlan[]
}
export interface DesiredLayout {
  guildId: string
  /** false: no project categories or plan channels are made, and existing ones are left alone. */
  plans: boolean
  projects: DesiredProject[]
}

/** One step towards the desired layout. Parents are named by slot: a category made earlier in the same batch has no id
 *  yet when the steps are computed. `remember` only updates the store. */
export type Op =
  | { op: 'createCategory'; slot: Slot; name: string }
  | {
      op: 'createChannel'
      slot: Slot
      name: string
      parent: Slot
      topic?: string
    }
  | { op: 'remember'; slot: Slot; id: string | null; name?: string }
  | { op: 'move'; slot: Slot; id: string; parent: Slot; unlock: boolean }
  | { op: 'rename'; slot: Slot; id: string; name: string }
  | { op: 'setTopic'; id: string; topic: string }
  | { op: 'deleteArchived'; slot: Slot; id: string }
  | { op: 'archive'; slot: Slot; id: string }
  | { op: 'setPositions'; slots: Slot[] }
  /** Some channel was not made because the guild is at GUILD_CHANNEL_CAP. */
  | { op: 'capped' }

const planSlot = (jobId: string): Slot => `ch:plan:${jobId}`
const projectSlot = (projectId: string): Slot => `cat:project:${projectId}`

/** The plan's state in words, and its rank in its project's channel order (0 needs the owner, 1 runs, 2 the rest). */
function planState(s: OrchState, job: Job): { rank: number; words: string } {
  if (awaitsApproval(job)) return { rank: 0, words: 'awaiting your approval' }
  const runs = s.runs.filter((r) => r.jobId === job.id)
  const runIds = new Set(runs.map((r) => r.id))
  if (s.gates.some((g) => g.status === 'open' && runIds.has(g.runId)))
    return { rank: 0, words: 'a question waits for you' }
  const last = runs.reduce<(typeof runs)[number] | undefined>((a, r) => (a && a.ordinal > r.ordinal ? a : r), undefined)
  const delivery = last?.deliveryState?.state
  if (delivery === 'needs-owner') return { rank: 0, words: 'delivery needs you' }
  if (job.deliveredBy || delivery === 'delivered' || delivery === 'delivered-by-owner')
    return { rank: 2, words: 'delivered' }
  const hold = holdOf(job)
  if (hold === 'replan-question') return { rank: 0, words: 'the planner asked you a question' }
  if (hold === 'owner') return { rank: 0, words: 'held by you: not launching new agents' }
  if (last?.paused === true) return { rank: 2, words: 'stopped' }
  if (job.paused) return { rank: 2, words: 'paused' }
  if (hold === 'final-check') return { rank: 1, words: 'final check before merging' }
  if (hold === 'replanning') return { rank: 1, words: 're-planning' }
  if (delivery === 'delivering' || delivery === 'retrying') return { rank: 1, words: 'merging into main' }
  if (job.pendingStart) return { rank: 2, words: 'planning' }
  if (last) return { rank: 1, words: 'running' }
  return { rank: 2, words: 'not started' }
}

/** The topic of a plan channel: its state in words and its Job id, by which a channel is matched back to its plan. */
export const planTopic = (words: string, jobId: string): string => `${words} · ${jobId}`

export function desiredLayout(state: OrchState, cfg: { guildId: string; plans: boolean }): DesiredLayout {
  if (!cfg.plans) return { guildId: cfg.guildId, plans: false, projects: [] }
  const byProject = new Map<
    string,
    {
      name: string
      plans: Array<DesiredPlan & { rank: number; createdAt: string }>
    }
  >()
  for (const job of state.jobs) {
    if (!isJobActive(job)) continue
    const p = projectOfJob(state, job)
    // a plan outside every project gets a category named after its folder
    const id = p?.id ?? `cwd:${job.cwd}`
    const group = byProject.get(id) ?? {
      name: (p?.name ?? (basename(job.cwd) || job.cwd)).slice(0, CHANNEL_NAME_MAX),
      plans: []
    }
    const st = planState(state, job)
    group.plans.push({
      jobId: job.id,
      name: channelSlug(jobNameOf(job)),
      topic: planTopic(st.words, job.id),
      rank: st.rank,
      createdAt: job.createdAt
    })
    byProject.set(id, group)
  }
  const projects = [...byProject].map(([id, g]) => ({
    id,
    name: g.name,
    plans: g.plans
      .sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId))
      .map(({ jobId, name, topic }) => ({ jobId, name, topic }))
  }))
  return { guildId: cfg.guildId, plans: true, projects }
}

/** Snowflakes grow with creation time: the smaller, the older. */
const olderFirst = (a: DiscordChannel, b: DiscordChannel): number =>
  a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byPosition = (a: DiscordChannel, b: DiscordChannel): number =>
  (a.position ?? 0) - (b.position ?? 0) || olderFirst(a, b)

/** The steps from the guild's channels to `desired`, parents before children; [] when the guild already matches. A
 *  store written for another guild counts as empty. */
export function reconcile(desired: DesiredLayout, guild: DiscordChannel[], storeIn: WorkspaceStore): Op[] {
  const store = storeIn.guildId === desired.guildId ? storeIn : emptyWorkspaceStore(desired.guildId)
  const byId = new Map(guild.map((c) => [c.id, c]))
  /** Ids found in this batch (a `remember` step), before the store has them; their steps go first. */
  const adoptions: Op[] = []
  const adopted = new Map<Slot, string>()
  const idOf = (slot: Slot): string | null => adopted.get(slot) ?? slotId(store, slot)
  const present = (slot: Slot): DiscordChannel | undefined => {
    const id = idOf(slot)
    return id === null ? undefined : byId.get(id)
  }
  /** A channel the store does not name yet but the bot made: recorded, and its name taken as the bot's last one. */
  const adopt = (slot: Slot, ch: DiscordChannel | undefined): DiscordChannel | undefined => {
    if (!ch) return undefined
    adopted.set(slot, ch.id)
    adoptions.push({ op: 'remember', slot, id: ch.id, name: ch.name })
    return ch
  }
  const owned = new Set([...Object.values(store.categories.projects), ...Object.values(store.channels.plans)])
  // The session connection makes #sessions under Astera by name when it runs first: such a category and channel are
  // the bot's, so they are taken over rather than made twice.
  const byName = (name: string, type: number, parent: Slot | null) => (): DiscordChannel | undefined => {
    const parentId = parent === null ? null : idOf(parent)
    if (parent !== null && parentId === null) return undefined
    return guild.find(
      (c) => c.type === type && c.name === name && (c.parent_id ?? null) === parentId && !owned.has(c.id)
    )
  }
  const createCats: Op[] = []
  const createChans: Op[] = []
  const fixes: Op[] = []
  const deletes: Op[] = []
  const archives: Op[] = []
  const positions: Op[] = []
  let count = guild.length
  let capped = false
  /** Counts one new channel against the guild cap; `room` asks for space for more (a category and its first child). */
  const canCreate = (room = 1): boolean => {
    if (count + room > GUILD_CHANNEL_CAP) {
      capped = true
      return false
    }
    count++
    return true
  }

  // A name the bot gave is put back only when the bot's own name changes: the owner's rename otherwise stays.
  const checkName = (slot: Slot, ch: DiscordChannel, name: string, last = store.names[ch.id]): void => {
    if (last === name) return
    fixes.push(ch.name === name ? { op: 'remember', slot, id: ch.id, name } : { op: 'rename', slot, id: ch.id, name })
  }

  const ensureCategory = (slot: Slot, name: string, room = 1, find?: () => DiscordChannel | undefined): boolean => {
    const found = present(slot)
    const ch = found ?? adopt(slot, find?.())
    if (ch) {
      checkName(slot, ch, name, found ? store.names[ch.id] : ch.name)
      return true
    }
    if (!canCreate(room)) return false
    createCats.push({ op: 'createCategory', slot, name })
    return true
  }

  /** The id of a channel already in place; 'new' when it is made or moved in this batch (its position is set after),
   *  'none' when it cannot be made. */
  const ensureChannel = (
    slot: Slot,
    name: string,
    parent: Slot,
    topic?: string,
    find?: () => DiscordChannel | undefined
  ): { id: string } | 'new' | 'none' => {
    const found = present(slot)
    const ch = found ?? adopt(slot, find?.())
    if (ch) {
      checkName(slot, ch, name, found ? store.names[ch.id] : ch.name)
      if (topic !== undefined && (ch.topic ?? '') !== topic) fixes.push({ op: 'setTopic', id: ch.id, topic })
      const parentId = idOf(parent)
      if (parentId === null || ch.parent_id !== parentId || !byId.has(parentId)) {
        const archiveId = store.categories.archive
        fixes.push({
          op: 'move',
          slot,
          id: ch.id,
          parent,
          unlock: archiveId !== null && ch.parent_id === archiveId
        })
        return 'new'
      }
      return { id: ch.id }
    }
    if (!canCreate()) return 'none'
    createChans.push({
      op: 'createChannel',
      slot,
      name,
      parent,
      ...(topic !== undefined ? { topic } : {})
    })
    return 'new'
  }

  if (ensureCategory('cat:astera', ASTERA_CATEGORY, 1, byName(ASTERA_CATEGORY, ChannelType.GUILD_CATEGORY, null))) {
    ensureChannel(
      'ch:control',
      CONTROL_CHANNEL,
      'cat:astera',
      undefined,
      byName(CONTROL_CHANNEL, ChannelType.GUILD_TEXT, 'cat:astera')
    )
    ensureChannel(
      'ch:sessions',
      SESSIONS_CHANNEL,
      'cat:astera',
      undefined,
      byName(SESSIONS_CHANNEL, ChannelType.GUILD_TEXT, 'cat:astera')
    )
  }

  if (desired.plans) {
    const active = new Set<string>()
    for (const project of desired.projects) {
      const cat = projectSlot(project.id)
      for (const p of project.plans) active.add(p.jobId)
      // a project category is made only with room for its first plan channel too
      if (!ensureCategory(cat, project.name, 2)) continue
      const placed = project.plans
        .map((p) => ({
          slot: planSlot(p.jobId),
          // the store lost this plan's id (a reset profile): the bot's channel carries the Job id in its topic
          at: ensureChannel(planSlot(p.jobId), p.name, cat, p.topic, () =>
            guild.find(
              (c) => c.type === ChannelType.GUILD_TEXT && !owned.has(c.id) && c.topic?.endsWith(` · ${p.jobId}`)
            )
          )
        }))
        .filter((x) => x.at !== 'none')
      const kept = placed.flatMap((x) => (typeof x.at === 'object' ? [x.at.id] : []))
      const nowOrder = guild
        .filter((c) => kept.includes(c.id))
        .sort(byPosition)
        .map((c) => c.id)
      if (kept.length < placed.length || nowOrder.join() !== kept.join())
        positions.push({
          op: 'setPositions',
          slots: placed.map((x) => x.slot)
        })
    }

    // Plans no longer active (archived, or gone from the state) go read-only into the archive category.
    const archiveId = store.categories.archive
    const toArchive: Array<{ slot: Slot; ch: DiscordChannel }> = []
    for (const [jobId, id] of Object.entries(store.channels.plans)) {
      if (active.has(jobId)) continue
      const ch = byId.get(id)
      if (!ch) fixes.push({ op: 'remember', slot: planSlot(jobId), id: null })
      else if (archiveId === null || ch.parent_id !== archiveId) toArchive.push({ slot: planSlot(jobId), ch })
    }
    if (toArchive.length > 0 && ensureCategory('cat:archive', ARCHIVE_CATEGORY)) {
      const inArchive = archiveId === null ? [] : guild.filter((c) => c.parent_id === archiveId)
      const ownSlot = new Map(Object.entries(store.channels.plans).map(([jobId, id]) => [id, planSlot(jobId)]))
      const deletable = inArchive.filter((c) => ownSlot.has(c.id)).sort(olderFirst)
      const excess = Math.min(inArchive.length + toArchive.length - ARCHIVE_CAP, deletable.length)
      for (const c of deletable.slice(0, Math.max(0, excess)))
        deletes.push({
          op: 'deleteArchived',
          slot: ownSlot.get(c.id)!,
          id: c.id
        })
      // channels the owner put in the archive category are never deleted: archive only what still fits
      const room = ARCHIVE_CAP - (inArchive.length - deletes.length)
      for (const a of toArchive.sort((x, y) => olderFirst(x.ch, y.ch)).slice(0, Math.max(0, room)))
        archives.push({ op: 'archive', slot: a.slot, id: a.ch.id })
    }
  }

  return [
    ...adoptions,
    ...createCats,
    ...createChans,
    ...fixes,
    ...deletes,
    ...archives,
    ...positions,
    ...(capped ? [{ op: 'capped' } as const] : [])
  ]
}

/** The channel of the plan whose Task's Dispatch ran in session `sessionId`, or null: worker sessions get their
 *  threads in their plan's channel. */
export function planChannelOfSession(state: OrchState, sessionId: string, store: WorkspaceStore): string | null {
  const d = state.dispatches.find((x) => x.sessionId === sessionId)
  const t = d && state.tasks.find((x) => x.id === d.taskId)
  if (!t) return null
  const jobId = t.jobId ?? state.runs.find((r) => r.id === t.runId)?.jobId
  return jobId === undefined ? null : (store.channels.plans[jobId] ?? null)
}
