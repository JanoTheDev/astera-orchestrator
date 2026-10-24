import { useEffect, useState } from 'react'
import { useSetting } from '../hooks/useSetting'
import type { GhProbe } from '../../../core/github/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Icon, Select, Switch } from './ui'

/** The GitHub pane of the settings modal (design doc §5). Reads state and instructs — there is
 *  deliberately no login button: auth belongs to `gh auth login` in a terminal. */
export function GithubSettings(): React.JSX.Element {
  const { t } = useI18n()
  // recheck(), not status(): main's cached probe can be stale by the time this tab opens (a background auth loss, or
  // a `gh auth login` run in a terminal since app start), and this is a local process call — about half a second —
  // that also broadcasts, so the worktree panel stays in step with whatever this tab just found (design doc §5).
  const [readProbe, setProbe] = useSetting<GhProbe>('githubProbe', () => window.api.github.recheck())
  const probe = readProbe ?? null // null = first read in flight
  const [polling, setPolling] = useSetting('githubPolling', () => window.api.settings.getGithubPolling(), true)
  const [checking, setChecking] = useState(false)
  const [readDefaults, setDefaults] = useSetting('githubDefaults', () => window.api.settings.getGithubDefaults())
  const defaults = readDefaults ?? null // null = first read in flight

  useEffect(() => {
    // Keeps tracking state changes while the tab stays open — a later auth loss, or a recheck
    // triggered elsewhere, must not leave this pane reporting a stale "Connected".
    const offStatus = window.api.on('github:status', setProbe)
    return () => offStatus()
  }, [])

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      setProbe(await window.api.github.recheck())
    } finally {
      setChecking(false)
    }
  }

  const saveDefaults = (next: NonNullable<typeof defaults>): void => {
    const prev = readDefaults
    setDefaults(next) // optimistic, reverted on failure like the polling switch
    void window.api.settings.setGithubDefaults(next).catch((err) => {
      setDefaults(prev)
      toast.error(t('github.settings.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <>
      <div className="settings-row">
        <span>{t('github.settings.status')}</span>
        <span>
          {probe === null || checking
            ? '…'
            : probe.kind === 'connected'
              ? probe.account
                ? t('github.settings.connected', { account: probe.account })
                : t('github.settings.connectedNoAccount')
              : probe.kind === 'not-installed'
                ? t('github.settings.notInstalled')
                : probe.kind === 'not-authenticated'
                  ? t('github.settings.notAuthenticated')
                  : t('github.settings.error')}
        </span>
      </div>
      {probe?.kind === 'not-installed' && (
        <div className="settings-row">
          <span />
          <Button size="sm" icon={<Icon name="external" size={14} />} onClick={() => void window.api.system.openExternal('https://cli.github.com')}>
            {t('github.settings.installLink')}
          </Button>
        </div>
      )}
      {probe?.kind === 'not-authenticated' && (
        <div className="settings-row">
          <code>gh auth login</code>
          <Button
            size="sm"
            icon={<Icon name="copy" size={14} />}
            onClick={() => {
              window.api.clipboard.writeText('gh auth login')
              toast.success(t('github.settings.commandCopied'))
            }}
          >
            {t('github.settings.copyCommand')}
          </Button>
        </div>
      )}
      <div className="settings-row">
        <span />
        <Button size="sm" variant="ghost" icon={<Icon name="refresh" size={14} />} loading={checking} onClick={() => void recheck()}>
          {t('github.settings.recheck')}
        </Button>
      </div>
      {/* A label so pressing the text toggles too — the same wrapping the orchestration row uses */}
      <label className="settings-row">
        <span>{t('github.settings.polling')}</span>
        <Switch
          checked={polling}
          onChange={(next) => {
            setPolling(next) // optimistic — reverted below on failure
            void window.api.settings.setGithubPolling(next).catch((err) => {
              setPolling(!next)
              toast.error(
                t('github.settings.saveFailed', {
                  detail: err instanceof Error ? err.message : String(err)
                })
              )
            })
          }}
        />
      </label>
      <span className="settings-hint">{t('github.settings.pollingHint')}</span>
      {defaults && (
        <>
          <h3 className="settings-card-title">{t('github.defaults.title')}</h3>
          <label className="settings-row">
            <span>{t('github.defaults.create')}</span>
            <Switch checked={defaults.createGithubRepo} onChange={(on) => saveDefaults({ ...defaults, createGithubRepo: on })} />
          </label>
          <span className="settings-hint">{t('github.defaults.createHint')}</span>
          <div className="settings-row">
            <span>{t('github.defaults.visibility')}</span>
            <Select
              aria-label={t('github.defaults.visibility')}
              value={defaults.visibility}
              onChange={(v) => saveDefaults({ ...defaults, visibility: v as 'private' | 'public' })}
              items={[
                { value: 'private', label: t('github.defaults.private') },
                { value: 'public', label: t('github.defaults.public') }
              ]}
            />
          </div>
        </>
      )}
    </>
  )
}
