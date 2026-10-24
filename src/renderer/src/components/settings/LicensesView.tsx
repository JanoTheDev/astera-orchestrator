// T28: Settings › About › Open source licenses. Every third-party notice scripts/gen-licenses.mjs collected, a search
// over name and license, and the full text of the one picked. Without the generated file (a dev run) it says how to make it.
import { useMemo, useState } from 'react'
import { useSetting } from '../../hooks/useSetting'
import type { LicenseEntry } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { Button, EmptyState, ICONS, Input, Modal } from '../ui'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

/** Entries whose name or license contains the query, case-insensitively. An empty query is every entry. */
export function filterLicenses(entries: readonly LicenseEntry[], query: string): LicenseEntry[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return [...entries]
  return entries.filter((e) => `${e.name} ${e.license}`.toLocaleLowerCase().includes(q))
}

export function LicensesView({ t, onClose }: { t: T; onClose: () => void }): React.JSX.Element {
  // undefined = still reading, null = no generated file
  const [entries] = useSetting<LicenseEntry[] | null>('licenses', () => window.api.app.licenses().catch(() => null))
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<LicenseEntry | null>(null)
  const shown = useMemo(() => filterLicenses(entries ?? [], query), [entries, query])
  const key = (e: LicenseEntry): string => `${e.kind}:${e.name}@${e.version}`

  return (
    <Modal title={t('about.licenses.title')} size="lg" onClose={onClose} closeLabel={t('common.close')}>
      {entries === undefined ? (
        <p className="settings-hint">{t('about.licenses.loading')}</p>
      ) : entries === null ? (
        <EmptyState icon={ICONS.licenses} title={t('about.licenses.missingTitle')}>
          {t('about.licenses.missing')}
        </EmptyState>
      ) : (
        <div className="licenses">
          <div className="licenses__list">
            <Input
              type="search"
              value={query}
              placeholder={t('about.licenses.search')}
              aria-label={t('about.licenses.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="settings-hint">{t('about.licenses.count', { count: shown.length })}</span>
            {shown.length === 0 ? (
              <p className="settings-hint">{t('about.licenses.empty', { query: query.trim() })}</p>
            ) : (
              <ul className="licenses__items">
                {shown.map((e) => (
                  <li key={key(e)}>
                    <Button
                      variant="ghost"
                      className="licenses__item"
                      aria-current={picked && key(picked) === key(e) ? 'true' : undefined}
                      onClick={() => setPicked(e)}
                    >
                      <span className="licenses__name">{e.name}</span>
                      <span className="licenses__meta">{[e.version, e.license].filter(Boolean).join(' · ')}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="licenses__text" aria-live="polite">
            {picked ? (
              <>
                <h3 className="settings-card-title">{[picked.name, picked.version].filter(Boolean).join(' ')}</h3>
                <p className="settings-card-desc">{picked.license}</p>
                {picked.text ? <pre className="licenses__pre">{picked.text}</pre> : <p className="settings-hint">{t('about.licenses.noText', { license: picked.license })}</p>}
              </>
            ) : (
              <p className="settings-hint">{t('about.licenses.pick')}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
