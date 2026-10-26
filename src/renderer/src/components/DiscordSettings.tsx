// Settings › Discord, on its own like TelegramSettings: the fields live here so typing a token does not redraw App.
// Unlike Telegram's, the stored bot token never reaches this screen — getConfig says only whether one exists.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { discordRepliesBlocked, isDiscordReady } from '../../../core/discord/ready'
import { toast } from '../lib/toast'
import { createTouched } from '../lib/touched'
import { useSetting } from '../hooks/useSetting'
import { Button, Card, Chip, Field, Switch } from './ui'

export function DiscordSettings(): React.JSX.Element {
  const { t } = useI18n()
  // Empty means "keep the stored token"; only a typed token is sent.
  const [botToken, setBotToken] = useState('')
  const [guildId, setGuildId] = useState('')
  const [userId, setUserId] = useState('')
  const [plans, setPlans] = useState(true)
  const [saved, setSaved] = useState(false)
  // Save sends the ids explicitly, so pressing it before getConfig returned would overwrite them with null.
  const [loaded, setLoaded] = useState(false)
  const touched = useRef(createTouched())

  const [cfg, setCfg] = useSetting('discordConfig', () =>
    window.api.discord.getConfig().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
      throw err
    })
  )
  useEffect(() => {
    if (!cfg) return
    touched.current.unless('guild', () => setGuildId(cfg.guildId ?? ''))
    touched.current.unless('user', () => setUserId(cfg.userId ?? ''))
    touched.current.unless('plans', () => setPlans(cfg.plans))
    setLoaded(true)
  }, [cfg])

  const hasToken = botToken.trim() !== '' || cfg?.hasToken === true
  const view = { botToken: hasToken ? 'set' : null, guildId: guildId.trim() || null, userId: userId.trim() || null }
  const ready = isDiscordReady(view)

  return (
    <Card className="settings-integration">
      <div className="settings-card-head">
        <h3 className="settings-card-title">{t('settings.row.discord')}</h3>
        <Chip tone={ready ? 'ok' : 'neutral'} dot>
          {t(ready ? 'settings.discord.status.ready' : 'settings.discord.status.notReady')}
        </Chip>
      </div>
      <p className="settings-card-desc">{t('settings.discord.hint')}</p>
      <div className="settings-integration-fields">
        <Field
          label={t('settings.discord.botToken')}
          type="password"
          value={botToken}
          placeholder={cfg?.hasToken ? t('settings.discord.botTokenStored') : undefined}
          autoComplete="off"
          onChange={(e) => {
            setBotToken(e.target.value)
            setSaved(false)
          }}
        />
        <Field
          label={t('settings.discord.guildId')}
          value={guildId}
          placeholder="123456789012345678"
          onChange={(e) => {
            touched.current.touch('guild')
            setGuildId(e.target.value)
            setSaved(false)
          }}
        />
        <Field
          label={t('settings.discord.userId')}
          hint={t('settings.discord.userIdHint')}
          error={discordRepliesBlocked(view) ? t('settings.discord.userIdRequired') : undefined}
          value={userId}
          placeholder="123456789012345678"
          onChange={(e) => {
            touched.current.touch('user')
            setUserId(e.target.value)
            setSaved(false)
          }}
        />
        <label className="settings-card-desc">
          <Switch
            checked={plans}
            onChange={(on) => {
              touched.current.touch('plans')
              setPlans(on)
              setSaved(false)
            }}
          />{' '}
          {t('settings.discord.plans')}
        </label>
        <p className="settings-card-desc">{t('settings.discord.plansHint')}</p>
      </div>
      <div className="settings-integration-actions">
        <Button
          disabled={!loaded}
          onClick={() => {
            const next = {
              ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
              guildId: guildId.trim() || null,
              userId: userId.trim() || null,
              plans
            }
            void window.api.discord
              .setConfig(next)
              .then(() => {
                setCfg({ hasToken, guildId: next.guildId, userId: next.userId, plans })
                setBotToken('')
                setSaved(true)
              })
              // A rejection means the store refused to overwrite values it could not read — the file on disk survived.
              .catch((err) =>
                toast.error(
                  t('settings.discord.saveFailed', {
                    detail: err instanceof Error ? err.message : String(err)
                  })
                )
              )
          }}
        >
          {t('settings.discord.save')}
        </Button>
        {cfg?.hasToken && (
          <Button
            onClick={() => {
              void window.api.discord
                .setConfig({ botToken: null })
                .then(() => {
                  setCfg({ ...cfg, hasToken: false })
                  setBotToken('')
                })
                .catch((err) =>
                  toast.error(
                    t('settings.discord.saveFailed', { detail: err instanceof Error ? err.message : String(err) })
                  )
                )
            }}
          >
            {t('settings.discord.removeToken')}
          </Button>
        )}
        {saved && <span className="update-note">{t('settings.discord.saved')}</span>}
      </div>
      <p className="settings-card-desc">{t(ready ? 'settings.discord.ready' : 'settings.discord.notReady')}</p>
      <p className="settings-card-desc">{t('settings.discord.setupGuide')}</p>
    </Card>
  )
}
