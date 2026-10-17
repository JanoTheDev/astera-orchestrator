import { useEffect, useState } from 'react'
import type { Account } from '../../../core/types'
import { PROVIDERS, PROVIDER_META, providerOf, type Provider } from '../../../core/providers/meta'
import {
  BUILTIN_ROLE_MODELS,
  DIFFICULTIES,
  MODEL_ID,
  ROLES,
  type Difficulty,
  type Role,
  type RoleModelSettings
} from '../../../core/orchestration/roleModels'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'

/** Which model each orchestration role and task difficulty runs on (orchestrator W1-A, SPEC §4).
 *
 *  **One block per provider that has an account.** Claude alone today; a Codex block appears by itself
 *  once a Codex account is in accounts.json — a model id belongs to one CLI, so the two are kept apart.
 *
 *  A field shows the built-in default until changed. **Empty means the CLI's own default** (stored as
 *  `''`, which masks the built-in one); free text, because the CLI takes an alias or a full model id. */
export function OrchestratorModelsSettings({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState<RoleModelSettings>({})

  useEffect(() => {
    void window.api.settings.getRoleModels().then(setValue)
  }, [])

  const providers = PROVIDERS.filter((p) => accounts.some((a) => providerOf(a) === p))

  const save = (provider: Provider, kind: 'roles' | 'difficulty', key: string, model: string): void => {
    const prev = value
    const own = value[provider] ?? {}
    const next: RoleModelSettings = { ...value, [provider]: { ...own, [kind]: { ...own[kind], [key]: model } } }
    setValue(next) // optimistic, reverted on failure
    void window.api.settings.setRoleModels(next).catch((err) => {
      setValue(prev)
      toast.error(t('settings.roleModels.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  const field = (provider: Provider, kind: 'roles' | 'difficulty', key: Role | Difficulty, label: string): React.JSX.Element => {
    const own = (value[provider]?.[kind] as Record<string, string> | undefined)?.[key]
    const shown = own ?? (BUILTIN_ROLE_MODELS[provider][kind] as Record<string, string>)[key] ?? ''
    return (
      <label className="settings-row" key={`${provider}-${kind}-${key}`}>
        <span>{label}</span>
        <input
          type="text"
          className="settings-gen-input"
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
        </div>
      ))}
    </div>
  )
}
