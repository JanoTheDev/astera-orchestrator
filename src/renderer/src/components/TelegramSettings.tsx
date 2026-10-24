// Settings › Telegram, on its own like SlackSettings: the fields live here so typing a token does not redraw App.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { isTelegramReady } from '../../../core/telegram/ready'
import { toast } from '../lib/toast'
import { createTouched } from '../lib/touched'
import { useSetting } from '../hooks/useSetting'
import { Button, Card, Chip, Field } from './ui'

export function TelegramSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  // The one Telegram user id allowed to reply into sessions. Left empty, every reply is blocked.
  const [userId, setUserId] = useState('')
  const [saved, setSaved] = useState(false)
  // Save sends all three fields explicitly, so pressing it before getConfig returned would overwrite the
  // stored token and ids with null.
  const [loaded, setLoaded] = useState(false)
  /** Fields changed before the configuration was read, each on its own: one shared flag would leave the
   *  others empty and Save would then send them as null over the stored ones. */
  const touched = useRef(createTouched())

  // Said, and Save stays off: saving the empty fields would erase the configuration it could not read.
  const [cfg, setCfg] = useSetting('telegramConfig', () =>
    window.api.telegram.getConfig().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
      throw err
    })
  )
  useEffect(() => {
    if (!cfg) return
    touched.current.unless('bot', () => setBotToken(cfg.botToken ?? ''))
    touched.current.unless('chat', () => setChatId(cfg.chatId ?? ''))
    touched.current.unless('user', () => setUserId(cfg.userId ?? ''))
    setLoaded(true)
  }, [cfg])

  const ready = isTelegramReady({ botToken: botToken.trim(), chatId: chatId.trim() })

  // W11 (DESIGN-W11 §9): a Card — title and status, what it does, the fields, then Save.
  return (
    <Card className="settings-integration">
      <div className="settings-card-head">
        <h3 className="settings-card-title">{t('settings.row.telegram')}</h3>
        <Chip tone={ready ? 'ok' : 'neutral'} dot>
          {t(ready ? 'settings.telegram.status.ready' : 'settings.telegram.status.notReady')}
        </Chip>
      </div>
      <p className="settings-card-desc">{t('settings.telegram.hint')}</p>
      <div className="settings-integration-fields">
        {/* The token is a password input: it reduces exposure over a shared screen, so every field has a label. */}
        <Field
          label={t('settings.telegram.botToken')}
          type="password"
          value={botToken}
          placeholder="123456:ABC-DEF…"
          onChange={(e) => {
            touched.current.touch('bot')
            setBotToken(e.target.value)
            setSaved(false)
          }}
        />
        <Field
          label={t('settings.telegram.chatId')}
          value={chatId}
          placeholder="123456789"
          onChange={(e) => {
            touched.current.touch('chat')
            setChatId(e.target.value)
            setSaved(false)
          }}
        />
        <Field
          label={t('settings.telegram.userId')}
          hint={t('settings.telegram.userIdHint')}
          error={ready && userId.trim() === '' ? t('settings.telegram.userIdRequired') : undefined}
          value={userId}
          placeholder="123456789"
          onChange={(e) => {
            touched.current.touch('user')
            setUserId(e.target.value)
            setSaved(false)
          }}
        />
      </div>
      <div className="settings-integration-actions">
        <Button
          disabled={!loaded}
          onClick={() => {
            const next = {
              botToken: botToken.trim() || null,
              chatId: chatId.trim() || null,
              userId: userId.trim() || null
            }
            void window.api.telegram
              .setConfig(next)
              .then(() => {
                setCfg(next)
                setSaved(true)
              })
              // A rejection means the store refused to overwrite values it could not read — the file on disk survived.
              .catch((err) =>
                toast.error(
                  t('settings.telegram.saveFailed', {
                    detail: err instanceof Error ? err.message : String(err)
                  })
                )
              )
          }}
        >
          {t('settings.telegram.save')}
        </Button>
        {saved && <span className="update-note">{t('settings.telegram.saved')}</span>}
      </div>
      <p className="settings-card-desc">{t(ready ? 'settings.telegram.ready' : 'settings.telegram.notReady')}</p>
      <p className="settings-card-desc">{t('settings.telegram.setupGuide')}</p>
    </Card>
  )
}
