// Which model each orchestration session runs on (orchestrator W1-A, SPEC §4).
//
// Pure, and imports no node module: the settings screen (renderer) reads the defaults and the reader,
// the start paths (exec/workerStart.ts) resolve through it. `undefined` always means "pass no model
// flag" — the CLI's own default, which is how every session started before this file existed.
//
// The flag itself is the command builders' (core/sessions/commands.ts): claude `--model <id>`, codex
// `-m <id>` — the same pair understanding/agentArgs.ts measured for its one-shot runs.
import type { Account } from '../types'
import { PROVIDERS, providerOf, type Provider } from '../providers/meta'
import type { Job, Task } from './types'

export type Role = 'coordinator' | 'planner' | 'worker' | 'reviewer'
export const ROLES = ['coordinator', 'planner', 'worker', 'reviewer'] as const satisfies readonly Role[]

export type Difficulty = 'light' | 'standard' | 'hard'
export const DIFFICULTIES = ['light', 'standard', 'hard'] as const satisfies readonly Difficulty[]

/** One provider's choices. **A key holding `''` is a choice too**: "no model here", which masks the
 *  built-in default below and lets resolution fall through to the next layer (for a role, the CLI's
 *  default). A missing key means "the built-in default". */
export interface ProviderModels {
  roles?: Partial<Record<Role, string>>
  difficulty?: Partial<Record<Difficulty, string>>
}
/** `app-settings.json`'s `roleModels`. Per provider, because a model id belongs to one CLI. */
export type RoleModelSettings = Partial<Record<Provider, ProviderModels>>

/** The owner's defaults (2026-10-17), as CLI aliases (`claude --help`: "an alias for the latest model
 *  (e.g. 'opus', 'sonnet')"). The worker role has none: a worker's model comes from its Task's
 *  difficulty. Codex has none yet: no codex account to measure its model names against. */
export const BUILTIN_ROLE_MODELS: Record<Provider, { roles: Partial<Record<Role, string>>; difficulty: Partial<Record<Difficulty, string>> }> = {
  claude: {
    roles: { coordinator: 'haiku', planner: 'opus', reviewer: 'opus' },
    difficulty: { light: 'haiku', standard: 'sonnet', hard: 'opus' }
  },
  codex: { roles: {}, difficulty: {} }
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

function readKeys<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, string>> | undefined {
  if (!isObject(v)) return undefined
  const out: Partial<Record<K, string>> = {}
  for (const k of keys) if (typeof v[k] === 'string') out[k] = (v[k] as string).trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/** Narrows a hand-editable file's value. Anything not of the shape is "not set" (built-in defaults). */
export function readRoleModelSettings(v: unknown): RoleModelSettings {
  if (!isObject(v)) return {}
  const out: RoleModelSettings = {}
  for (const p of PROVIDERS) {
    const roles = readKeys(isObject(v[p]) ? v[p].roles : undefined, ROLES)
    const difficulty = readKeys(isObject(v[p]) ? v[p].difficulty : undefined, DIFFICULTIES)
    if (roles || difficulty) out[p] = { ...(roles ? { roles } : {}), ...(difficulty ? { difficulty } : {}) }
  }
  return out
}

/** The configured value: the setting when it has the key (`''` → undefined), else the built-in one. */
function configured(settings: RoleModelSettings, provider: Provider, kind: 'roles', key: Role): string | undefined
function configured(settings: RoleModelSettings, provider: Provider, kind: 'difficulty', key: Difficulty): string | undefined
function configured(settings: RoleModelSettings, provider: Provider, kind: 'roles' | 'difficulty', key: string): string | undefined {
  const own = (settings[provider]?.[kind] as Record<string, string> | undefined)?.[key]
  const v = own !== undefined ? own : (BUILTIN_ROLE_MODELS[provider][kind] as Record<string, string>)[key]
  return v ? v : undefined
}

/** Does this id belong to the other CLI? A Job override and `Task.model` name no provider, and handing
 *  `--model gpt-5` to claude (or `-m opus` to codex) fails the start.
 *  shortcut: name prefixes only, enough for the aliases and the two vendors' naming; upgrade to the
 *  account's own model list (core/models) if a third provider or an unprefixed id shows up. */
export function modelFitsProvider(model: string, provider: Provider): boolean {
  const claudeish = /^(claude|opus|sonnet|haiku|fable)/i.test(model)
  const codexish = /^(gpt|o\d|codex)/i.test(model)
  return provider === 'claude' ? !codexish : !claudeish
}

const fitting = (model: string | undefined, provider: Provider): string | undefined =>
  model && modelFitsProvider(model, provider) ? model : undefined

/** The model for `role` on `provider`: the Job's override, then the app's setting (or the built-in
 *  default), then undefined (the CLI's default). **W2-A's planner calls this — keep the signature.** */
export function resolveRoleModel(
  appSettings: RoleModelSettings,
  job: Pick<Job, 'models'> | undefined,
  role: Role,
  provider: Provider
): string | undefined {
  return fitting(job?.models?.[role]?.trim(), provider) ?? configured(appSettings, provider, 'roles', role)
}

/** The providers that have at least one account in accounts.json — the only ones a Task may run on. */
export function providersWithAccounts(accounts: readonly Account[]): Set<Provider> {
  return new Set(accounts.map(providerOf))
}

/** Where a Task asks to run, and why it cannot when it cannot. **Only among providers that have an
 *  account** (owner decision 2026-10-17): a Task that asks for one with none falls back to claude.
 *  The ask is `Task.provider`, else its first account's provider (the old rule, Task.accountIds), else
 *  claude. */
export function pickTaskProvider(
  task: Pick<Task, 'provider' | 'accountIds'>,
  accounts: readonly Account[]
): { provider: Provider; note?: string } {
  const first = task.accountIds?.length ? accounts.find((a) => a.id === task.accountIds![0]) : undefined
  const wanted = task.provider ?? (first ? providerOf(first) : 'claude')
  if (wanted === 'claude' || providersWithAccounts(accounts).has(wanted)) return { provider: wanted }
  return { provider: 'claude', note: `task asked for ${wanted}, which has no account — ran on claude` }
}

/** A worker's model. Task.model > difficulty map > Job override > app default > CLI default.
 *  `provider` is the one the Dispatch really runs on (its account's). When the Task asked for another
 *  one, its `model` was meant for that CLI and is dropped, and `note` says why (recorded on the
 *  Dispatch as `modelNote`). */
export function resolveWorkerModel(a: {
  settings: RoleModelSettings
  job: Pick<Job, 'models'> | undefined
  task: Pick<Task, 'model' | 'difficulty' | 'provider' | 'accountIds'> | undefined
  provider: Provider
  accounts: readonly Account[]
}): { model?: string; note?: string } {
  const task = a.task
  let note: string | undefined
  let ownModel = task?.model?.trim()
  if (task?.provider && task.provider !== a.provider) {
    note = pickTaskProvider(task, a.accounts).note ?? `task asked for ${task.provider}; its account is ${a.provider} — ran on ${a.provider}`
    ownModel = undefined
  }
  const model =
    fitting(ownModel, a.provider) ??
    (task?.difficulty ? configured(a.settings, a.provider, 'difficulty', task.difficulty) : undefined) ??
    resolveRoleModel(a.settings, a.job, 'worker', a.provider)
  return { ...(model ? { model } : {}), ...(note ? { note } : {}) }
}

const TIERS = ['haiku', 'sonnet', 'opus'] as const
const tierOf = (model: string | undefined): number => (model ? TIERS.findIndex((t) => model.toLowerCase().includes(t)) : -1)

/** A reviewer's model. Normally the `reviewer` role's. **When it reviews on the implementer's own
 *  provider** (only one provider has accounts, owner decision 2026-10-17) it must not be the
 *  implementer's model — the same model reading its own work repeats its blind spots. Then it moves one
 *  tier up (haiku → sonnet → opus); from the top tier, one down, since there is no stronger alias. */
export function resolveReviewerModel(a: {
  settings: RoleModelSettings
  job: Pick<Job, 'models'> | undefined
  provider: Provider
  impl: { provider: Provider; model?: string }
}): { model?: string; note?: string } {
  const model = resolveRoleModel(a.settings, a.job, 'reviewer', a.provider)
  if (a.impl.provider !== a.provider || model !== a.impl.model) return model ? { model } : {}
  const tier = tierOf(model)
  if (tier < 0)
    return {
      ...(model ? { model } : {}),
      note: `same-provider review on the implementer's model (${model ?? 'CLI default'}): no tier to move to`
    }
  const moved = TIERS[tier < TIERS.length - 1 ? tier + 1 : tier - 1]
  return { model: moved, note: `same-provider review: reviewer model ${model} is the implementer's — moved to ${moved}` }
}

/** What a worker start hands back about its model, as the Dispatch fields that record it. Every
 *  place that patches a started Dispatch (worker-start, review, repair, recovery) spreads this. */
export const dispatchModelFields = (s: { model?: string; modelNote?: string }): { model?: string; modelNote?: string } => ({
  ...(s.model ? { model: s.model } : {}),
  ...(s.modelNote ? { modelNote: s.modelNote } : {})
})
