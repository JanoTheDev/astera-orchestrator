// Settings › Agents › Custom instructions: per role, the text Astera appends to the end of its prompt (never in
// place of it), with the byte count against the cap and a read-only sample of the built-in text it follows.
import { useEffect, useId, useState } from 'react'
import type { PromptInfo, PromptRole } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { confirmModal } from '../../lib/confirm'
import { Button, Icon, Section, Select, Textarea } from '../ui'
import { byteLength, editorState, MAX_INSTRUCTION_BYTES, PROMPT_ROLES, saveFailure } from './instructionsLogic'
import './finder.css'

const detailOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function PromptInstructionsEditor(): React.JSX.Element {
  const { t } = useI18n()
  const id = useId()
  const [role, setRole] = useState<PromptRole>('session')
  const [infos, setInfos] = useState<PromptInfo[]>([])
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ text: string } | { error: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const roleLabel = (r: PromptRole): string => t(`settings.instructions.role.${r}`)
  const refreshList = (): void => void window.api.prompts.list().then(setInfos, () => undefined)

  const load = (r: PromptRole): void => {
    setSaved(null)
    setLoadError(null)
    setPreview(null)
    window.api.prompts.get(r).then(
      (text) => {
        setSaved(text)
        setDraft(text)
      },
      (err) => setLoadError(detailOf(err))
    )
    window.api.prompts.preview(r).then(
      (text) => setPreview({ text }),
      (err) => setPreview({ error: detailOf(err) })
    )
  }
  useEffect(() => {
    refreshList()
    load(role)
  }, [role])

  const state = editorState(draft, saved ?? '')
  const bytes = byteLength(draft)

  const pickRole = async (next: string): Promise<void> => {
    if (next === role) return
    if (state.dirty && !(await confirmModal({ title: t('settings.instructions.discardTitle'), body: t('settings.instructions.discardBody'), danger: true }))) return
    setRole(next as PromptRole)
  }

  const save = async (): Promise<void> => {
    if (!state.canSave || busy) return
    setBusy(true)
    try {
      const r = await window.api.prompts.set(role, draft)
      const f = saveFailure(r)
      if (f === null) {
        setSaved(draft)
        toast.success(t('settings.instructions.saved', { role: roleLabel(role) }))
        refreshList()
      } else if (f.key === 'tooLong') toast.error(t('settings.instructions.tooLong', { max: f.max ?? MAX_INSTRUCTION_BYTES }))
      else toast.error(t('settings.instructions.saveFailed', { detail: f.detail ?? (r.ok ? '' : r.error) }))
    } catch (err) {
      toast.error(t('settings.instructions.saveFailed', { detail: detailOf(err) }))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (busy || !(await confirmModal({ title: t('settings.instructions.resetConfirm', { role: roleLabel(role) }), body: t('settings.instructions.resetBody'), danger: true }))) return
    setBusy(true)
    try {
      const r = await window.api.prompts.reset(role)
      if (r.ok) {
        setSaved('')
        setDraft('')
        toast.success(t('settings.instructions.resetDone', { role: roleLabel(role) }))
        refreshList()
      } else toast.error(t('settings.instructions.saveFailed', { detail: 'message' in r ? r.message : r.error }))
    } catch (err) {
      toast.error(t('settings.instructions.saveFailed', { detail: detailOf(err) }))
    } finally {
      setBusy(false)
    }
  }

  const isSet = (r: PromptRole): boolean => infos.some((i) => i.role === r && i.set)
  const countId = `${id}-count`

  return (
    <div className="instructions">
      <div className="instructions__bar">
        <label htmlFor={`${id}-role`}>{t('settings.instructions.role')}</label>
        <Select
          id={`${id}-role`}
          value={role}
          onChange={(v) => void pickRole(v)}
          items={PROMPT_ROLES.map((r) => ({ value: r, label: roleLabel(r), meta: isSet(r) ? t('settings.instructions.isSet') : undefined }))}
        />
      </div>
      {loadError !== null ? (
        <div className="finder__state" role="alert">
          <span>{t('settings.instructions.loadFailed', { detail: loadError })}</span>
          <Button size="sm" variant="ghost" icon={<Icon name="refresh" />} onClick={() => load(role)}>
            {t('finder.retry')}
          </Button>
        </div>
      ) : saved === null ? (
        <div className="finder__state" aria-busy="true">
          <Icon name="loading" size={14} />
          {t('finder.loading')}
        </div>
      ) : (
        <>
          <Textarea
            className="instructions__text"
            aria-label={t('settings.instructions.label', { role: roleLabel(role) })}
            aria-describedby={countId}
            aria-invalid={state.tooLong || undefined}
            placeholder={t('settings.instructions.placeholder')}
            spellCheck={false}
            rows={8}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="instructions__bar">
            <span id={countId} className={state.tooLong ? 'instructions__count instructions__count--over' : 'instructions__count'} aria-live="polite">
              {t('settings.instructions.bytes', { n: bytes, max: MAX_INSTRUCTION_BYTES })}
              {state.tooLong && ` · ${t('settings.instructions.tooLong', { max: MAX_INSTRUCTION_BYTES })}`}
              {state.dirty && !state.tooLong && ` · ${t('settings.instructions.unsaved')}`}
            </span>
            <Button variant="ghost" icon={<Icon name="reset" />} disabled={busy || (saved === '' && draft === '')} onClick={() => void reset()}>
              {t('settings.instructions.reset')}
            </Button>
            <Button variant="primary" icon={<Icon name="save" />} loading={busy} disabled={!state.canSave} onClick={() => void save()}>
              {t('settings.instructions.save')}
            </Button>
          </div>
        </>
      )}
      <Section id="settings-instructions-preview" label={t('settings.instructions.preview')} defaultOpen={false}>
        <p className="finder__note">{t('settings.instructions.previewHint')}</p>
        {preview === null ? (
          <div className="finder__state" aria-busy="true">
            {t('finder.loading')}
          </div>
        ) : 'error' in preview ? (
          <div className="finder__state" role="alert">
            <span>{t('settings.instructions.previewFailed', { detail: preview.error })}</span>
            <Button size="sm" variant="ghost" icon={<Icon name="refresh" />} onClick={() => load(role)}>
              {t('finder.retry')}
            </Button>
          </div>
        ) : (
          <pre className="instructions__preview" tabIndex={0} aria-label={t('settings.instructions.preview')}>
            {preview.text}
          </pre>
        )}
      </Section>
    </div>
  )
}
