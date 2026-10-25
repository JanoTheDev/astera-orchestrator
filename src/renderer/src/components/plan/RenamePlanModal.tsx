// The rename dialog of a plan: the Plans tree and the Main plan tab share it (renameJob in lib/jobActions does the work).
import { useState } from 'react'
import { Button, Input, Modal } from '../ui'
import { useI18n } from '../../i18n/I18nProvider'

export function RenamePlanModal({ initial, onRename, onClose }: { initial: string; onRename: (title: string) => void; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [title, setTitle] = useState(initial)
  const submit = (): void => {
    onRename(title)
    onClose()
  }
  return (
    <Modal title={t('jobs.lifecycle.rename')} size="sm" onClose={onClose} closeLabel={t('common.close')} footer={<Button variant="primary" onClick={submit}>{t('common.confirm')}</Button>}>
      <Input
        autoFocus
        value={title}
        placeholder={t('jobs.lifecycle.titlePlaceholder')}
        aria-label={t('jobs.lifecycle.rename')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.key !== 'Enter') return
          submit()
        }}
      />
    </Modal>
  )
}
