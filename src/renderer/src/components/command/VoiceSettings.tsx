import { useEffect, useState } from 'react'
import { readVoiceSettings, type VoiceSettings as Voice } from '../../../../core/intents/speech'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import './command.css'
import { Input } from '../ui'

/** W3-B: where the owner's whisper.cpp binary and model are. Nothing is downloaded; the steps to get both are shown
 *  here and in docs/guide.md. Paths must be absolute: a relative one would resolve against the app's cwd. */
export function VoiceSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState<Voice>({})

  useEffect(() => {
    void window.api.settings.getVoice().then(setValue)
  }, [])

  const field = (key: keyof Voice, label: string, placeholder: string): React.JSX.Element => {
    const shown = value[key] ?? ''
    return (
      <label className="settings-row">
        <span>{label}</span>
        <Input
          type="text"
          className="settings-text-field"
          aria-label={label}
          placeholder={placeholder}
          key={shown}
          defaultValue={shown}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (next === shown) return
            const narrowed = readVoiceSettings({ ...value, [key]: next })
            if (next !== '' && narrowed[key] === undefined) {
              e.target.value = shown
              toast.error(t('settings.voice.notAbsolute'))
              return
            }
            const prev = value
            setValue(narrowed)
            void window.api.settings.setVoice(narrowed).catch((err) => {
              setValue(prev)
              toast.error(t('settings.voice.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
            })
          }}
        />
      </label>
    )
  }

  return (
    <div className="settings-group">
      <span>{t('settings.voice.title')}</span>
      <span className="settings-hint">{t('settings.voice.hint')}</span>
      {field('whisperBinary', t('settings.voice.binary'), '/home/you/whisper.cpp/build/bin/whisper-cli')}
      {field('whisperModel', t('settings.voice.model'), '/home/you/whisper.cpp/models/ggml-base.en.bin')}
      <ol className="voice-setup">
        <li>
          <code>git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp</code>
        </li>
        <li>
          <code>cmake -B build && cmake --build build -j --config Release</code>
        </li>
        <li>
          <code>sh ./models/download-ggml-model.sh base.en</code>
        </li>
      </ol>
    </div>
  )
}
