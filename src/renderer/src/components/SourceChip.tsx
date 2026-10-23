import type { JobSourceRef } from '../../../core/orchestration/types'
import { useI18n } from '../i18n/I18nProvider'
import { Button } from './ui'

/** Where a Job came from (plugin Phase 4 J18): its source's label (`Linear ENG-123`), which opens the ticket in the
 *  browser when the source gave a link. On the Job's card the click must not reach the card's header, which folds the
 *  card. Nothing for a Job made otherwise. */
export function SourceChip({ source }: { source: JobSourceRef | undefined }): React.JSX.Element | null {
  const { t } = useI18n()
  if (source === undefined) return null
  const url = source.url
  if (url === undefined)
    return (
      <span className="source-chip" title={source.label}>
        {source.label}
      </span>
    )
  return (
    <Button
      variant="ghost"
      size="sm"
      className="source-chip"
      title={t('jobs.source.chipOpen', { label: source.label })}
      onClick={(e) => {
        e.stopPropagation()
        void window.api.system.openExternal(url)
      }}
    >
      {source.label}
    </Button>
  )
}
