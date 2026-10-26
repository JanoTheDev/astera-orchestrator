// The Discord plan workspace in the Host (core/discord/workspace/): while the Discord connection is applied with
// `plans` on, the server follows Astera's plans. The Host's activity log drives it: an event that changes a plan runs
// the layout sync (debounced, one at a time, at most one queued), then refreshes the touched plans' pinned cards and
// posts each opened Gate's buttons in its plan's channel. Activity notices go to #astera, worker sessions' roots to
// their plan's channel, and every Gateway dispatch the inbox does not consume to planWorkspace.onDispatch.
//
// It rides the Discord connection (discordConnection.ts): its REST client and Gateway, so one token keeps one Gateway
// per profile. connectionsWiring.ts calls `apply` after the connection's own apply and `stop` before its stop, so the
// workspace runs exactly while this Host holds the connections; the settings reload re-applies it like any connection.
//
// One file, `<profile>/discord-workspace.json`, holds the layout's ids and the cards' message ids; every write to it
// goes through one queue here, so a card saved while a sync runs is not written over.
//
// The bot token is in the config this module compares, never in a log line.
//
// Imports only core modules, node builtins and this folder: this bundles into the Host.
import path from 'node:path'
import type { DiscordConfig } from '../core/discord/config'
import type { DiscordRest } from '../core/discord/rest'
import { syncLayout } from '../core/discord/workspace/apply'
import { planChannelOfSession } from '../core/discord/workspace/layout'
import { planWorkspace, type Handle, type PlanWorkspace } from '../core/discord/workspace/interactions'
import { readWorkspaceStore, writeWorkspaceStore, type WorkspaceStore } from '../core/discord/workspace/store'
import type { ActivityEvent, ActivityNotice } from '../core/orchestration/activity'
import { projectOfJob } from '../core/orchestration/projects'
import type { OrchState } from '../core/orchestration/state'
import type { Lang } from '../core/i18n'
import type { HostEventLog } from './eventLog'

export const WORKSPACE_FILE = 'discord-workspace.json'
/** How long the layout sync waits for more events before it runs. */
export const WORKSPACE_DEBOUNCE_MS = 2_000
/** How long the follow waits on a quiet activity log before it looks again. */
const FOLLOW_TICK_MS = 60_000

const PLAN_EVENTS: ReadonlySet<string> = new Set(['task.status', 'gate.opened', 'gate.resolved', 'run.pr', 'dispatch.started'])
const changesPlan = (type: string): boolean => PLAN_EVENTS.has(type) || type.startsWith('plan.')

export interface DiscordWorkspaceDeps {
  profileDir: string
  /** The Discord connection's REST client, null while it has none applied. */
  rest(): DiscordRest | null
  activity: Pick<HostEventLog, 'read' | 'tail' | 'next'>
  state(): OrchState
  /** The Host's orch.handle. */
  handle: Handle
  lang(): Lang
  /** discord.log. */
  log(m: string): void
  /** Test seam: WORKSPACE_DEBOUNCE_MS. */
  debounceMs?: number
}

export interface DiscordWorkspace {
  /** Starts, restarts (the settings changed) or stops the workspace for `cfg`. Never rejects. */
  apply(cfg: DiscordConfig): Promise<void>
  stop(): Promise<void>
  running(): boolean
  /** The plan channel of a worker session, for its root; null for the default #sessions. */
  rootChannel(sessionId?: string): Promise<string | null>
  /** A Gateway dispatch the inbox did not consume; true when the workspace handled it. */
  onDispatch(type: string, data: unknown): boolean
  /** Posts the notice to #astera; false (nothing posted) when the workspace has no #astera to post to. */
  postNotice(n: Pick<ActivityNotice, 'title' | 'body'>): boolean
}

interface Live {
  cfg: DiscordConfig & { guildId: string }
  rest: DiscordRest
  store: WorkspaceStore
  ws: PlanWorkspace
  /** Plans whose card wants refreshing at the next sync, and Gates whose question wants posting. */
  touched: Set<string>
  gates: string[]
  timer: ReturnType<typeof setTimeout> | null
  busy: boolean
}

export function createDiscordWorkspace(d: DiscordWorkspaceDeps): DiscordWorkspace {
  const storePath = path.join(d.profileDir, WORKSPACE_FILE)
  const debounceMs = d.debounceMs ?? WORKSPACE_DEBOUNCE_MS
  /** The running start; a stop or a restart replaces it, and whatever an old one still has in flight checks this. */
  let live: Live | null = null
  /** The config the running start was made for, as JSON; null while stopped. */
  let key: string | null = null
  let writes: Promise<unknown> = Promise.resolve()
  /** Every read-modify-write of the store, one at a time. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = writes.then(fn)
    writes = p.catch(() => {})
    return p
  }

  const schedule = (run: Live, ms = debounceMs): void => {
    // a busy sync schedules the next one itself when it ends
    if (run.timer || run.busy || live !== run) return
    run.timer = setTimeout(() => {
      run.timer = null
      void flush(run)
    }, ms)
    run.timer.unref?.()
  }

  async function flush(run: Live): Promise<void> {
    if (live !== run) return
    run.busy = true
    const jobs = [...run.touched]
    const gates = run.gates.splice(0)
    run.touched.clear()
    try {
      const store = await serial(() =>
        live === run ? syncLayout({ state: d.state(), cfg: run.cfg, rest: run.rest, storePath, log: d.log }) : Promise.resolve(null)
      )
      if (live !== run) return
      if (store) run.store = store
      for (const jobId of jobs) await run.ws.refreshCard(jobId)
      const s = d.state()
      for (const id of gates) {
        const gate = s.gates.find((g) => g.id === id)
        if (gate?.status === 'open') await run.ws.postGate(gate)
      }
    } catch (err) {
      d.log(`discord workspace: a sync failed: ${err instanceof Error ? err.name : 'error'}`)
    } finally {
      run.busy = false
      if (run.touched.size > 0 || run.gates.length > 0) schedule(run)
    }
  }

  function noteEvents(run: Live, events: readonly ActivityEvent[]): void {
    let any = false
    for (const e of events) {
      if (!changesPlan(e.type)) continue
      any = true
      const jobId = e.jobId ?? (e.runId === undefined ? undefined : d.state().runs.find((r) => r.id === e.runId)?.jobId)
      if (jobId !== undefined) run.touched.add(jobId)
      if (e.type === 'gate.opened' && e.payload.gateId !== undefined) run.gates.push(e.payload.gateId)
    }
    if (any) schedule(run)
  }

  /** The activity log from now on, as index.ts's notices follow it, until this start ends. */
  function follow(run: Live): void {
    let after = d.activity.tail()
    void (async () => {
      while (live === run) {
        try {
          const page = d.activity.read({ after, limit: 500 })
          if ('error' in page) after = d.activity.tail()
          else {
            after = page.cursor
            noteEvents(run, page.events as unknown as ActivityEvent[])
            if (page.events.length > 0) continue
          }
        } catch (err) {
          d.log(`discord workspace: could not read the activity feed: ${String(err)}`)
        }
        await d.activity.next(FOLLOW_TICK_MS)
      }
    })()
  }

  async function start(cfg: Live['cfg'], rest: DiscordRest): Promise<boolean> {
    const store = await serial(() => readWorkspaceStore(storePath, cfg.guildId))
    if (store === null) {
      d.log(`discord workspace: ${WORKSPACE_FILE} could not be read; the plan workspace waits for the next settle`)
      return false
    }
    const planOfChannel = (channelId: string): string | null =>
      Object.entries(run.store.channels.plans).find(([, id]) => id === channelId)?.[0] ?? null
    const run: Live = {
      cfg,
      rest,
      store,
      touched: new Set(),
      gates: [],
      timer: null,
      busy: false,
      ws: planWorkspace({
        rest,
        handle: d.handle,
        state: d.state,
        cfg: () => run.cfg,
        lang: d.lang,
        log: d.log,
        channelOfPlan: (jobId) => run.store.channels.plans[jobId] ?? null,
        planOfChannel,
        // shortcut: only a plan channel knows its project (the store keeps no channel's parent); /plan new elsewhere names one
        projectOfChannel: (channelId) => {
          const jobId = planOfChannel(channelId)
          const s = d.state()
          const job = jobId === null ? undefined : s.jobs.find((j) => j.id === jobId)
          return job ? (projectOfJob(s, job)?.id ?? null) : null
        },
        homeChannel: () => run.store.channels.control,
        cards: store.cards,
        saveCards: (cards) =>
          void serial(async () => {
            if (live !== run) return
            const now = await readWorkspaceStore(storePath, cfg.guildId)
            if (now === null) return d.log(`discord workspace: ${WORKSPACE_FILE} could not be read; a card id was not saved`)
            await writeWorkspaceStore(storePath, { ...now, cards })
          }).catch((err: unknown) => d.log(`discord workspace: a card id was not saved (${err instanceof Error ? err.name : 'error'})`))
      })
    }
    live = run
    // Once per start; the Gateway's READY (every reconnect) is not passed on for it (onDispatch below).
    void rest
      .application()
      .then((app) => (live === run ? run.ws.registerCommands(app.id) : undefined))
      .catch(() => d.log('discord workspace: the application could not be read; /plan was not registered'))
    // Every open plan's channel and card on start; the follow then brings each change.
    for (const job of d.state().jobs) if (job.archivedAt === undefined) run.touched.add(job.id)
    schedule(run, 0)
    follow(run)
    return true
  }

  async function stop(): Promise<void> {
    if (live?.timer) clearTimeout(live.timer)
    live = null
    key = null
  }

  return {
    apply: async (cfg) => {
      try {
        const rest = d.rest()
        const want = cfg.plans && cfg.botToken !== null && cfg.guildId !== null && rest !== null
        const next = want ? JSON.stringify(cfg) : null
        if (next === key) return
        await stop()
        if (!want) return
        key = next
        if (!(await start({ ...cfg, guildId: cfg.guildId! }, rest!))) key = null
      } catch (err) {
        key = null
        d.log(`discord workspace: could not start (${err instanceof Error ? err.name : 'error'})`)
      }
    },
    stop,
    running: () => live !== null,
    rootChannel: async (sessionId) => (live && sessionId ? planChannelOfSession(d.state(), sessionId, live.store) : null),
    onDispatch: (type, data) => (live && type !== 'READY' ? live.ws.onDispatch(type, data) : false),
    postNotice: (n) => {
      if (!live?.store.channels.control) return false
      void live.ws.postNotice(n)
      return true
    }
  }
}
