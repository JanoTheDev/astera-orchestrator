import type { TranscriptPreview } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { Button, Modal } from './ui'

/** A transcript's read-only preview (`history.preview`): History's row preview, and (W7-F #84) a plan tree row whose
 *  tab was closed. One markup for both. */
export function TranscriptPreviewModal({ preview, onClose }: { preview: TranscriptPreview; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal
      title={`${t('history.entry.preview')} ${preview.truncated ? t('history.preview.truncated') : ''}`.trim()}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="preview-scroll">
        {preview.messages.map((m, i) => (
          <p key={i} className={`msg ${m.role}`}>
            <b>{m.role === 'user' ? t('history.preview.me') : 'Claude'}</b> {m.text}
          </p>
        ))}
      </div>
    </Modal>
  )
}
