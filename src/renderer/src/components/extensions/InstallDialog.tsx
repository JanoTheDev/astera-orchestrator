// The finder's install dialog: which accounts to install into (all of them to start), and for an MCP server the
// env vars or headers it needs, secret ones in password inputs. The decisions live in finderLogic.ts.
import { useMemo, useState } from 'react'
import type { Account, McpInput } from '../../../../core/types'
import { PROVIDERS, PROVIDER_META } from '../../../../core/providers/meta'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Checkbox, Field, Modal } from '../ui'
import { accountsByProvider, canInstall, defaultPick, initialValues, missingInputs, providerPick, toggleProvider } from './finderLogic'

export function InstallDialog({
  name,
  accounts,
  inputs,
  already,
  busy,
  onInstall,
  onClose
}: {
  name: string
  accounts: readonly Account[]
  /** The MCP server's env vars or headers; empty for a skill. */
  inputs: readonly McpInput[]
  /** Accounts that already have it: the backend refuses those, so they start unpicked and say why. */
  already: ReadonlySet<string>
  busy: boolean
  onInstall: (accountIds: string[], values: Record<string, string>) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const byProvider = useMemo(() => accountsByProvider(accounts), [accounts])
  const [picked, setPicked] = useState<Set<string>>(() => new Set([...defaultPick(accounts)].filter((id) => !already.has(id))))
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(inputs))
  const [tried, setTried] = useState(false)
  const missing = missingInputs(inputs, values)
  const ok = canInstall(picked, missing)

  const submit = (): void => {
    setTried(true)
    if (ok && !busy) onInstall([...picked], values)
  }

  return (
    <Modal
      title={t('finder.dialog.title', { name })}
      onClose={busy ? undefined : onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} aria-disabled={!ok}>
            {busy ? t('finder.installing') : t('finder.install')}
          </Button>
        </>
      }
    >
      <form
        className="finder__form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="finder__group">
          <span className="finder__heading">{t('finder.dialog.accounts')}</span>
          {PROVIDERS.map((p) => {
            const list = byProvider[p].filter((a) => !already.has(a.id))
            const box = providerPick(list.map((a) => a.id), picked)
            const display = PROVIDER_META[p].displayName
            return (
              <fieldset key={p} className="finder__group">
                <legend>
                  <Checkbox
                    label={display}
                    checked={box.checked}
                    indeterminate={box.indeterminate}
                    disabled={box.disabled || busy}
                    onChange={() => setPicked(toggleProvider(list.map((a) => a.id), picked))}
                  />
                </legend>
                <div className="finder__indent">
                  {byProvider[p].length === 0 && <p className="finder__note">{t('finder.dialog.noAccounts', { provider: display })}</p>}
                  {byProvider[p].map((a) =>
                    already.has(a.id) ? (
                      <Checkbox key={a.id} label={`${a.label} (${t('finder.dialog.already')})`} checked disabled />
                    ) : (
                      <Checkbox
                        key={a.id}
                        label={a.label}
                        checked={picked.has(a.id)}
                        disabled={busy}
                        onChange={(on) => {
                          const next = new Set(picked)
                          if (on) next.add(a.id)
                          else next.delete(a.id)
                          setPicked(next)
                        }}
                      />
                    )
                  )}
                </div>
              </fieldset>
            )
          })}
          {tried && picked.size === 0 && (
            <p className="finder__note finder__note--error" role="alert">
              {t('finder.dialog.noAccountPicked')}
            </p>
          )}
        </div>
        {inputs.length > 0 && (
          <div className="finder__group">
            <span className="finder__heading">{t('finder.dialog.values')}</span>
            {inputs.map((i) => (
              <Field
                key={i.name}
                label={i.required ? `${i.name} (${t('finder.dialog.required')})` : i.name}
                hint={[i.description, i.hint].filter(Boolean).join(' · ') || undefined}
                error={tried && missing.includes(i.name) ? t('finder.dialog.missing') : undefined}
                type={i.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={values[i.name] ?? ''}
                disabled={busy}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [i.name]: e.target.value })}
              />
            ))}
            {inputs.some((i) => i.secret) && <p className="finder__note">{t('finder.dialog.secretHint')}</p>}
          </div>
        )}
      </form>
    </Modal>
  )
}
