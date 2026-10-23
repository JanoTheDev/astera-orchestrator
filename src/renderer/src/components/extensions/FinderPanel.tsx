// Settings › Integrations › MCP & skills finder: search the MCP registry or the skill repos, install into chosen
// Claude and Codex accounts, and see (and remove what the finder may remove) what each account has. Every call
// answers failures as values (ExtensionsApi); a thrown call is read the same way.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, McpCatalogEntry, McpInstalled, SkillCatalogEntry, SkillInstalled } from '../../../../core/types'
import { PROVIDER_META, providerOf } from '../../../../core/providers/meta'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { confirmModal } from '../../lib/confirm'
import { Button, Chip, Icon, Input, Tabs } from '../ui'
import { byAccount, inputsOf, installedIn, mcpOrigin, mcpRemovable, SEARCH_DEBOUNCE_MS, skillRemovable, splitResults, filledValues } from './finderLogic'
import { InstallDialog } from './InstallDialog'
import { SkillReposEditor } from './SkillReposEditor'
import './finder.css'

type Kind = 'mcp' | 'skills'
type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; value: T }
type McpPage = { servers: McpCatalogEntry[]; next: string | null }
type SkillPage = { skills: SkillCatalogEntry[]; repoErrors: string[] }
type Target = { kind: 'mcp'; entry: McpCatalogEntry } | { kind: 'skills'; entry: SkillCatalogEntry }

const detailOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The search box's value, settled for SEARCH_DEBOUNCE_MS. */
function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [value])
  return settled
}

function StateLine({ loaded, onRetry, empty }: { loaded: Loaded<unknown>; onRetry: () => void; empty?: boolean }): React.JSX.Element | null {
  const { t } = useI18n()
  if (loaded.state === 'loading')
    return (
      <div className="finder__state" aria-busy="true">
        <Icon name="loading" size={14} />
        {t('finder.loading')}
      </div>
    )
  if (loaded.state === 'error')
    return (
      <div className="finder__state" role="alert">
        <Icon name="error" size={14} />
        <span>{t('finder.error', { detail: loaded.message })}</span>
        <Button size="sm" variant="ghost" icon={<Icon name="refresh" />} onClick={onRetry}>
          {t('finder.retry')}
        </Button>
      </div>
    )
  if (empty) return <p className="finder__note">{t('finder.empty')}</p>
  return null
}

export function FinderPanel({ accounts }: { accounts: readonly Account[] }): React.JSX.Element {
  const { t } = useI18n()
  const [kind, setKind] = useState<Kind>('mcp')
  const [query, setQuery] = useState('')
  const q = useDebounced(query)
  const [mcp, setMcp] = useState<Loaded<McpPage>>({ state: 'loading' })
  const [skills, setSkills] = useState<Loaded<SkillPage>>({ state: 'loading' })
  const [moreBusy, setMoreBusy] = useState(false)
  const [mcpInstalled, setMcpInstalled] = useState<Loaded<McpInstalled[]>>({ state: 'loading' })
  const [skillsInstalled, setSkillsInstalled] = useState<Loaded<SkillInstalled[]>>({ state: 'loading' })
  const [target, setTarget] = useState<Target | null>(null)
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  /** Only the latest search may land: an older, slower answer is dropped. */
  const seq = useRef(0)
  const labelOf = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a.label]))
    return (id: string): string => m.get(id) ?? id
  }, [accounts])

  const search = (): void => {
    const n = ++seq.current
    if (kind === 'mcp') {
      setMcp({ state: 'loading' })
      window.api.extensions.mcpSearch(q).then(
        (r) => n === seq.current && setMcp(r.ok ? { state: 'ok', value: { servers: r.servers, next: r.nextCursor } } : { state: 'error', message: r.message }),
        (err) => n === seq.current && setMcp({ state: 'error', message: detailOf(err) })
      )
    } else {
      setSkills({ state: 'loading' })
      window.api.extensions.skillsSearch(q).then(
        (r) => n === seq.current && setSkills({ state: 'ok', value: { skills: r.skills, repoErrors: r.errors.map((e) => e.repo) } }),
        (err) => n === seq.current && setSkills({ state: 'error', message: detailOf(err) })
      )
    }
  }
  useEffect(search, [kind, q])

  const more = async (): Promise<void> => {
    if (mcp.state !== 'ok' || !mcp.value.next || moreBusy) return
    const n = seq.current
    setMoreBusy(true)
    try {
      const r = await window.api.extensions.mcpSearch(q, mcp.value.next)
      if (n !== seq.current) return
      if (r.ok) setMcp({ state: 'ok', value: { servers: [...mcp.value.servers, ...r.servers], next: r.nextCursor } })
      else toast.error(t('finder.error', { detail: r.message }))
    } catch (err) {
      toast.error(t('finder.error', { detail: detailOf(err) }))
    } finally {
      setMoreBusy(false)
    }
  }

  const loadInstalled = (which: Kind): void => {
    if (which === 'mcp') {
      setMcpInstalled({ state: 'loading' })
      window.api.extensions.mcpInstalled().then(
        (v) => setMcpInstalled({ state: 'ok', value: v }),
        (err) => setMcpInstalled({ state: 'error', message: detailOf(err) })
      )
    } else {
      setSkillsInstalled({ state: 'loading' })
      window.api.extensions.skillsInstalled().then(
        (v) => setSkillsInstalled({ state: 'ok', value: v }),
        (err) => setSkillsInstalled({ state: 'error', message: detailOf(err) })
      )
    }
  }
  useEffect(() => loadInstalled(kind), [kind])

  const installedItems = (kind === 'mcp' ? mcpInstalled : skillsInstalled) as Loaded<(McpInstalled | SkillInstalled)[]>
  const already = (name: string): Set<string> => (installedItems.state === 'ok' ? installedIn(installedItems.value, name) : new Set())

  const install = async (accountIds: string[], values: Record<string, string>): Promise<void> => {
    if (!target) return
    setInstalling(true)
    try {
      const r =
        target.kind === 'mcp' && target.entry.recipe
          ? await window.api.extensions.mcpInstall({ accountIds, name: target.entry.name, recipe: target.entry.recipe, values: filledValues(values) })
          : await window.api.extensions.skillsInstall({ accountIds, repo: (target.entry as SkillCatalogEntry).repo, path: (target.entry as SkillCatalogEntry).path })
      const { ok, failed } = splitResults(r, labelOf)
      if (ok.length > 0) toast.success(t('finder.installed.ok', { name: target.entry.name, accounts: ok.join(', '), note: r.note }))
      for (const f of failed) toast.error(t('finder.installed.failed', { account: f.label, detail: f.message }))
      setTarget(null)
    } catch (err) {
      toast.error(t('finder.installed.failed', { account: accountIds.map(labelOf).join(', '), detail: detailOf(err) }))
    } finally {
      setInstalling(false)
      loadInstalled(target.kind)
    }
  }

  const remove = async (accountId: string, name: string): Promise<void> => {
    const account = labelOf(accountId)
    if (!(await confirmModal({ title: t('finder.remove.confirmTitle', { name }), body: t('finder.remove.confirmBody', { account }), danger: true }))) return
    setRemoving(`${accountId}/${name}`)
    try {
      const r = kind === 'mcp' ? await window.api.extensions.mcpRemove(accountId, name) : await window.api.extensions.skillsRemove(accountId, name)
      if (r.ok) toast.success(t('finder.remove.done', { name, account }))
      else toast.error(t('finder.remove.failed', { name, detail: r.message }))
    } catch (err) {
      toast.error(t('finder.remove.failed', { name, detail: detailOf(err) }))
    } finally {
      setRemoving(null)
      loadInstalled(kind)
    }
  }

  const noAccounts = accounts.length === 0
  const installButton = (onClick: () => void, label: string, disabled = false): React.JSX.Element => (
    <Button size="sm" icon={<Icon name="add" />} disabled={disabled || noAccounts} onClick={onClick} aria-label={t('finder.installLabel', { name: label })}>
      {t('finder.install')}
    </Button>
  )

  const results = kind === 'mcp' ? mcp : skills
  const found = mcp.state === 'ok' && kind === 'mcp' ? mcp.value.servers.length : skills.state === 'ok' && kind === 'skills' ? skills.value.skills.length : null
  return (
    <div className="finder">
      <Tabs<Kind>
        label={t('finder.tabs')}
        value={kind}
        onChange={setKind}
        items={[
          { id: 'mcp', label: t('finder.tab.mcp') },
          { id: 'skills', label: t('finder.tab.skills') }
        ]}
      />
      <div className="finder__search">
        <Input
          type="search"
          aria-label={t(kind === 'mcp' ? 'finder.search.mcp' : 'finder.search.skills')}
          placeholder={t(kind === 'mcp' ? 'finder.search.mcp' : 'finder.search.skills')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {noAccounts && <p className="finder__note">{t('finder.noAccounts')}</p>}

      <StateLine loaded={results} onRetry={search} empty={found === 0} />
      {kind === 'mcp' && mcp.state === 'ok' && (
        <>
          <ul className="finder__list finder__list--results" aria-label={t('finder.results')} tabIndex={0}>
            {mcp.value.servers.map((s) => (
              <li key={s.id} className="finder__item">
                <div>
                  <div className="finder__name">{s.title || s.name}</div>
                  {s.description && <p className="finder__desc">{s.description}</p>}
                  <div className="finder__meta">
                    {s.id}
                    {s.version && ` · ${s.version}`}
                  </div>
                  {!s.recipe && <p className="finder__note">{t('finder.notInstallable', { reason: s.notInstallable ?? '' })}</p>}
                </div>
                <span className="finder__actions">{installButton(() => setTarget({ kind: 'mcp', entry: s }), s.title || s.name, !s.recipe)}</span>
              </li>
            ))}
          </ul>
          {mcp.value.next && (
            <Button size="sm" variant="ghost" loading={moreBusy} onClick={() => void more()}>
              {t('finder.more')}
            </Button>
          )}
        </>
      )}
      {kind === 'skills' && skills.state === 'ok' && (
        <>
          {skills.value.repoErrors.length > 0 && (
            <p className="finder__note finder__note--error" role="alert">
              {t('finder.repoErrors', { repos: skills.value.repoErrors.join(', ') })}
            </p>
          )}
          <ul className="finder__list finder__list--results" aria-label={t('finder.results')} tabIndex={0}>
            {skills.value.skills.map((s) => (
              <li key={`${s.repo}/${s.path}`} className="finder__item">
                <div>
                  <div className="finder__name">{s.name}</div>
                  {s.description && <p className="finder__desc">{s.description}</p>}
                  <div className="finder__meta">
                    {s.repo}/{s.path}
                  </div>
                </div>
                <span className="finder__actions">{installButton(() => setTarget({ kind: 'skills', entry: s }), s.name)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <span className="finder__heading">{t('finder.installedTitle')}</span>
      <StateLine loaded={installedItems} onRetry={() => loadInstalled(kind)} />
      {installedItems.state === 'ok' &&
        byAccount(installedItems.value, accounts).map(({ account, items }) => (
          <div key={account.id} className="finder__account">
            <div className="finder__account-name">
              <Chip>{PROVIDER_META[providerOf(account)].displayName}</Chip>
              <span>{account.label}</span>
            </div>
            {items.length === 0 ? (
              <p className="finder__note">{t('finder.installed.none')}</p>
            ) : (
              <ul className="finder__list">
                {items.map((i) => {
                  const isMcp = kind === 'mcp'
                  const origin = isMcp ? mcpOrigin(i as McpInstalled) : (i as SkillInstalled).origin
                  const canRemove = isMcp ? mcpRemovable(i as McpInstalled) : skillRemovable(i as SkillInstalled)
                  const detail = isMcp ? ((i as McpInstalled).url ?? (i as McpInstalled).command ?? (i as McpInstalled).transport) : (i as SkillInstalled).description
                  return (
                    <li key={i.name} className="finder__item">
                      <div>
                        <div className="finder__name">{i.name}</div>
                        {detail && <p className={isMcp ? 'finder__meta' : 'finder__desc'}>{detail}</p>}
                      </div>
                      <span className="finder__actions">
                        {origin && <Chip tone={origin === 'astera' ? 'info' : origin === 'finder' ? 'ok' : 'neutral'}>{t(`finder.origin.${origin}`)}</Chip>}
                        {canRemove && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Icon name="delete" />}
                            loading={removing === `${account.id}/${i.name}`}
                            aria-label={t('finder.removeLabel', { name: i.name, account: account.label })}
                            onClick={() => void remove(account.id, i.name)}
                          >
                            {t('finder.remove')}
                          </Button>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}

      {kind === 'skills' && <SkillReposEditor onChange={search} />}

      {target && (
        <InstallDialog
          name={target.entry.name}
          accounts={accounts}
          inputs={target.kind === 'mcp' && target.entry.recipe ? inputsOf(target.entry.recipe) : []}
          already={already(target.entry.name)}
          busy={installing}
          onInstall={(ids, values) => void install(ids, values)}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  )
}
