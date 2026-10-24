import { useEffect, useState } from 'react'
import { useSetting } from '../hooks/useSetting'
import type { Account } from '../../../core/types'
import { PROVIDERS, PROVIDER_META, providerOf, type Provider } from '../../../core/providers/meta'
import {
  BUILTIN_EFFORTS,
  BUILTIN_ROLE_MODELS,
  DIFFICULTIES,
  EFFORTS,
  MODEL_ID,
  ROLES,
  type Difficulty,
  type EffortRole,
  type Role,
  type RoleModelSettings
} from '../../../core/orchestration/roleModels'
import { CODEX_EFFORT_ROWS } from '../../../core/models/cliModels'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Input, Select } from './ui'

const EFFORT_ROLES: readonly EffortRole[] = ['planner', 'reviewer', 'coordinator']
const NO_MODELS: RoleModelSettings = {}

/** The select's value for "no entry saved, use the built-in default". */
const BUILTIN = 'builtin'

/** `value` with one effort entry set; `BUILTIN` removes the key. The model keys are carried over untouched. */
export function withEffort(
  value: RoleModelSettings,
  provider: Provider,
  kind: 'roles' | 'difficulty',
  key: string,
  choice: string
): RoleModelSettings {
  const own = value[provider] ?? {}
  const { [key]: _drop, ...rest } = (own.effort?.[kind] ?? {}) as Record<string, string>
  const entries = choice === BUILTIN ? rest : { ...rest, [key]: choice }
  return { ...value, [provider]: { ...own, effort: { ...own.effort, [kind]: entries } } }
}

/** Which model each orchestration role and task difficulty runs on (orchestrator W1-A, SPEC §4).
 *
 *  **One block per provider that has an account.** Claude alone today; a Codex block appears by itself
 *  once a Codex account is in accounts.json — a model id belongs to one CLI, so the two are kept apart.
 *
 *  A field shows the built-in default until changed. **Empty means the CLI's own default** (stored as
 *  `''`, which masks the built-in one); free text, because the CLI takes an alias or a full model id. */
export function OrchestratorModelsSettings({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useSetting<RoleModelSettings>('roleModels', () => window.api.settings.getRoleModels(), NO_MODELS)

  const providers = PROVIDERS.filter((p) => accounts.some((a) => providerOf(a) === p))

  const persist = (next: RoleModelSettings): void => {
    const prev = value
    setValue(next) // optimistic, reverted on failure
    void window.api.settings.setRoleModels(next).catch((err) => {
      setValue(prev)
      toast.error(t('settings.roleModels.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  const save = (provider: Provider, kind: 'roles' | 'difficulty', key: string, model: string): void => {
    const own = value[provider] ?? {}
    persist({ ...value, [provider]: { ...own, [kind]: { ...own[kind], [key]: model } } })
  }

  const effortField = (provider: Provider, kind: 'roles' | 'difficulty', key: EffortRole | Difficulty, label: string): React.JSX.Element => {
    const builtin = (BUILTIN_EFFORTS[provider][kind] as Record<string, string>)[key]
    const own = (value[provider]?.effort?.[kind] as Record<string, string> | undefined)?.[key]
    const levels = provider === 'codex' ? EFFORTS.filter((l) => l in CODEX_EFFORT_ROWS) : EFFORTS
    const cliDefault = t('settings.roleModels.effortCliDefault')
    // a provider with no built-in has nothing to name, so "unset" and '' are the same choice
    const current = own ?? (builtin ? BUILTIN : '')
    return (
      <div className="settings-row" key={`${provider}-effort-${kind}-${key}`}>
        <span>{label}</span>
        <Select
          className="settings-gen-select"
          ariaLabel={`${PROVIDER_META[provider].displayName} ${label} ${t('settings.roleModels.effort')}`}
          value={current}
          onChange={(v) => persist(withEffort(value, provider, kind, key, v))}
          items={[
            ...(builtin ? [{ value: BUILTIN, label: t('settings.roleModels.effortDefault', { level: builtin }) }] : []),
            { value: '', label: cliDefault },
            ...levels.map((l) => ({ value: l, label: l }))
          ]}
        />
      </div>
    )
  }

  const field = (provider: Provider, kind: 'roles' | 'difficulty', key: Role | Difficulty, label: string): React.JSX.Element => {
    const own = (value[provider]?.[kind] as Record<string, string> | undefined)?.[key]
    const shown = own ?? (BUILTIN_ROLE_MODELS[provider][kind] as Record<string, string>)[key] ?? ''
    return (
      <label className="settings-row" key={`${provider}-${kind}-${key}`}>
        <span>{label}</span>
        <Input
          type="text"
          className="settings-text-field"
          aria-label={`${PROVIDER_META[provider].displayName} ${label}`}
          placeholder={key === 'worker' ? t('settings.roleModels.workerPlaceholder') : t('settings.roleModels.placeholder')}
          // keyed on the stored value so a revert or a late load re-renders the field
          key={shown}
          defaultValue={shown}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (next !== '' && !MODEL_ID.test(next)) {
              e.target.value = shown
              toast.error(t('settings.roleModels.invalid', { model: next }))
              return
            }
            if (next !== shown) save(provider, kind, key, next)
          }}
        />
      </label>
    )
  }

  return (
    <div className="settings-group">
      <span>{t('settings.roleModels.title')}</span>
      <span className="settings-hint">{t('settings.roleModels.hint')}</span>
      {providers.length === 0 ? <span className="settings-hint">{t('settings.roleModels.noAccounts')}</span> : null}
      {providers.map((p) => (
        <div className="settings-stack" key={p}>
          <span>{PROVIDER_META[p].displayName}</span>
          {ROLES.map((r) => field(p, 'roles', r, t(`settings.roleModels.role.${r}`)))}
          {DIFFICULTIES.map((d) => field(p, 'difficulty', d, t(`settings.roleModels.difficulty.${d}`)))}
          <span className="settings-hint">{t('settings.roleModels.effortHint')}</span>
          {EFFORT_ROLES.map((r) => effortField(p, 'roles', r, t(`settings.roleModels.role.${r}`)))}
          {DIFFICULTIES.map((d) => effortField(p, 'difficulty', d, t(`settings.roleModels.difficulty.${d}`)))}
        </div>
      ))}
    </div>
  )
}
