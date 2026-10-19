// Settings › Telegram, on its own like SlackSettings: the fields live here so typing a token does not redraw App.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { createTouched } from '../lib/touched'

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

  useEffect(() => {
    let cancelled = false
    void window.api.telegram.getConfig().then(
      (c) => {
        if (cancelled) return
        touched.current.unless('bot', () => setBotToken(c.botToken ?? ''))
        touched.current.unless('chat', () => setChatId(c.chatId ?? ''))
        touched.current.unless('user', () => setUserId(c.userId ?? ''))
        setLoaded(true)
      },
      // Said, and Save stays off: saving the empty fields would erase the configuration it could not read.
      (err) => toast.error(err instanceof Error ? err.message : String(err))
    )
    return () => {
      cancelled = true
    }
  }, [])

  const ready = !!botToken.trim() && !!chatId.trim()

  return (
    <div className="settings-slack">
      {/* The token is a password input: it reduces exposure over a shared screen, so every field has a label. */}
      <label className="settings-field-label">{t('settings.telegram.botToken')}</label>
      <input
        type="password"
        className="slack-url-input"
        value={botToken}
        placeholder="123456:ABC-DEF…"
        onChange={(e) => {
          touched.current.touch('bot')
          setBotToken(e.target.value)
          setSaved(false)
        }}
      />
      <label className="settings-field-label">{t('settings.telegram.chatId')}</label>
      <input
        type="text"
        className="slack-url-input"
        value={chatId}
        placeholder="123456789"
        onChange={(e) => {
          touched.current.touch('chat')
          setChatId(e.target.value)
          setSaved(false)
        }}
      />
      <label className="settings-field-label">{t('settings.telegram.userId')}</label>
      <input
        type="text"
        className="slack-url-input"
        value={userId}
        placeholder="123456789"
        onChange={(e) => {
          touched.current.touch('user')
          setUserId(e.target.value)
          setSaved(false)
        }}
      />
      <span className="settings-hint">{t('settings.telegram.userIdHint')}</span>
      {ready && userId.trim() === '' && (
        <span className="update-note update-err">{t('settings.telegram.userIdRequired')}</span>
      )}
      <div className="slack-cell">
        <button
          disabled={!loaded}
          onClick={() =>
            void window.api.telegram
              .setConfig({
                botToken: botToken.trim() || null,
                chatId: chatId.trim() || null,
                userId: userId.trim() || null
              })
              .then(() => setSaved(true))
              // A rejection means the store refused to overwrite values it could not read — the file on disk survived.
              .catch((err) =>
                toast.error(
                  t('settings.telegram.saveFailed', {
                    detail: err instanceof Error ? err.message : String(err)
                  })
                )
              )
          }
        >
          {t('settings.telegram.save')}
        </button>
        {saved && <span className="update-note">{t('settings.telegram.saved')}</span>}
      </div>
      <span className="settings-hint">
        {t(ready ? 'settings.telegram.ready' : 'settings.telegram.notReady')}
      </span>
      <span className="settings-hint">{t('settings.telegram.hint')}</span>
      <span className="settings-hint">{t('settings.telegram.setupGuide')}</span>
    </div>
  )
}
