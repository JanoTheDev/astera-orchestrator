// Settings › Slack, on its own (audit UI-1): its five fields were App's state, so every keystroke in a token drew the
// whole app and every pane under it again. The fields live here; App draws this and nothing changes there as one types.
import { useEffect, useRef, useState } from 'react'
import { slackMode } from '../../../core/slack/ready'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { createTouched } from '../lib/touched'
import { useSetting } from '../hooks/useSetting'
import { Button, Card, Chip, Field, type ChipTone } from './ui'

export function SlackSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [slackUrl, setSlackUrl] = useState('') // the Slack Webhook URL in the settings modal
  const [slackSaved, setSlackSaved] = useState(false)
  // Bot configuration. appToken is for Socket Mode receiving only, so for now it is merely stored
  const [slackBotToken, setSlackBotToken] = useState('')
  const [slackChannelId, setSlackChannelId] = useState('')
  const [slackAppToken, setSlackAppToken] = useState('')
  // The one Slack Member ID allowed to reply into sessions. Left empty, every reply is blocked
  const [slackMemberId, setSlackMemberId] = useState('')
  // Saving is blocked until getConfig has returned — the save button sends all five fields
  // explicitly, so pressing it while they are still empty strings would overwrite an already-stored
  // token, channel, and webhook with null in one go. (When there was a single field, patch()
  // preserving undefined protected the rest; that is no longer the case.)
  const [slackLoaded, setSlackLoaded] = useState(false)
  /** The fields changed before the configuration was read (audit UI-7), each on its own (final review I-4): one flag
   *  for all five left the other four empty, and Save then sent them as null over the stored ones. */
  const touched = useRef(createTouched())

  // Said, and Save stays off (audit UI-7): saving the empty fields would erase the configuration it could not read.
  const [cfg, setCfg] = useSetting('slackConfig', () =>
    window.api.slack.getConfig().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
      throw err
    })
  )
  useEffect(() => {
    if (!cfg) return
    touched.current.unless('url', () => setSlackUrl(cfg.webhookUrl ?? ''))
    touched.current.unless('bot', () => setSlackBotToken(cfg.botToken ?? ''))
    touched.current.unless('channel', () => setSlackChannelId(cfg.channelId ?? ''))
    touched.current.unless('app', () => setSlackAppToken(cfg.appToken ?? ''))
    touched.current.unless('member', () => setSlackMemberId(cfg.memberId ?? ''))
    setSlackLoaded(true)
  }, [cfg])

  // Which transport the current input adds up to. The verdict is slackMode() from core: it has to be the same function
  // that applyConfig (in main) and the notification checkbox gating use, so one side cannot drift from the other.
  const mode = slackMode({
    webhookUrl: slackUrl.trim() || null,
    botToken: slackBotToken.trim() || null,
    channelId: slackChannelId.trim() || null
  })
  const status: Record<typeof mode, { tone: ChipTone; label: 'settings.slack.status.bot' | 'settings.slack.status.webhook' | 'settings.slack.status.off' }> = {
    bot: { tone: 'ok', label: 'settings.slack.status.bot' },
    webhook: { tone: 'info', label: 'settings.slack.status.webhook' },
    off: { tone: 'neutral', label: 'settings.slack.status.off' }
  }

  // W11 (DESIGN-W11 §9): a Card — title and status, what it does, the fields, then Save.
  return (
    <Card className="settings-integration">
      <div className="settings-card-head">
        <h3 className="settings-card-title">{t('settings.row.slack')}</h3>
        <Chip tone={status[mode].tone} dot>
          {t(status[mode].label)}
        </Chip>
      </div>
      <p className="settings-card-desc">{t('settings.slack.hint')}</p>
      <div className="settings-integration-fields">
        <Field
          label="Slack Webhook URL"
          value={slackUrl}
          placeholder="https://hooks.slack.com/services/…"
          onChange={(e) => {
            touched.current.touch('url')
            setSlackUrl(e.target.value)
            setSlackSaved(false)
          }}
        />
        {/* Bot configuration. Tokens are password inputs — it reduces exposure over a shared screen or a shoulder. Once
            filled, a password shows only ●●●, so every field needs a label to say what it is */}
        <h4 className="settings-integration-sub">{t('settings.slack.botSection')}</h4>
        <Field
          label="Bot Token"
          type="password"
          value={slackBotToken}
          placeholder="xoxb-…"
          onChange={(e) => {
            touched.current.touch('bot')
            setSlackBotToken(e.target.value)
            setSlackSaved(false)
          }}
        />
        <Field
          label="Channel ID"
          hint={t('settings.slack.channelIdHint')}
          value={slackChannelId}
          placeholder="C0123456789"
          onChange={(e) => {
            touched.current.touch('channel')
            setSlackChannelId(e.target.value)
            setSlackSaved(false)
          }}
        />
        <Field
          label="App Token"
          type="password"
          hint={t('settings.slack.appTokenHint')}
          value={slackAppToken}
          placeholder="xapp-…"
          onChange={(e) => {
            touched.current.touch('app')
            setSlackAppToken(e.target.value)
            setSlackSaved(false)
          }}
        />
        {/* The one member allowed to reply into sessions. The channel alone is not a permission boundary — anyone
            invited there could push input into a session — so replies are matched against this ID. Left empty, every
            reply is blocked rather than allowed (core/slack/inbound.ts), which is why the warning is loud. It is gated
            on bot mode, not on the full intake condition (which also needs the app token): slackMode() is the verdict
            core already owns. In bot mode without an app token there is no intake at all, and the warning still
            reads true there. */}
        <Field
          label="Member ID"
          hint={t('settings.slack.memberIdHint')}
          error={mode === 'bot' && slackMemberId.trim() === '' ? t('settings.slack.memberIdRequired') : undefined}
          value={slackMemberId}
          placeholder="U0123456789"
          onChange={(e) => {
            touched.current.touch('member')
            setSlackMemberId(e.target.value)
            setSlackSaved(false)
          }}
        />
      </div>
      <div className="settings-integration-actions">
        <Button
          disabled={!slackLoaded}
          onClick={() => {
            const next = {
              webhookUrl: slackUrl.trim() || null,
              botToken: slackBotToken.trim() || null,
              channelId: slackChannelId.trim() || null,
              appToken: slackAppToken.trim() || null,
              memberId: slackMemberId.trim() || null
            }
            void window.api.slack
              .setConfig(next)
              .then(() => {
                setCfg(next)
                setSlackSaved(true)
              })
              // A rejection means the store refused to overwrite values it could not read — the settings on disk
              // survived. Saying so beats a silently dead button, since "Saved" never appears either way.
              .catch((err) =>
                toast.error(
                  t('settings.slack.saveFailed', {
                    detail: err instanceof Error ? err.message : String(err)
                  })
                )
              )
          }}
        >
          {t('settings.slack.save')}
        </Button>
        {slackSaved && <span className="update-note">{t('settings.slack.saved')}</span>}
      </div>
      {/* Shows immediately which transport the current input adds up to — filling in a bot token but leaving out the
          channel ID falls back to the Webhook silently, so that has to be visible. */}
      <p className="settings-card-desc">
        {t(
          (
            {
              bot: 'settings.slack.modeBot',
              webhook: 'settings.slack.modeWebhook',
              off: 'settings.slack.modeOff'
            } as const
          )[mode]
        )}
      </p>
      <p className="settings-card-desc">{t('settings.slack.setupGuide')}</p>
    </Card>
  )
}
