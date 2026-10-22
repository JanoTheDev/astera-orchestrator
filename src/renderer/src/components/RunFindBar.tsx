import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { Icon, IconButton, Input } from './ui'

/** The find bar drawn inside a run's console (top-right, over the output). Plain text,
 *  case-insensitive — no regex or case toggles in this slice. Enter → next, Shift+Enter → previous,
 *  Esc → close. RunPanel owns the query and the results; this only draws them. */
export function RunFindBar({
  query,
  results,
  onQueryChange,
  onNext,
  onPrev,
  onClose
}: {
  query: string
  /** null until a search has run; total 0 means nothing matched; a null index means the addon stopped
   *  tracking which match is active (past its highlight limit) — the total is still right */
  results: { index: number | null; total: number } | null
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  // Opening the bar is a request to type — take the focus from the terminal
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <div className="run-find" role="search">
      <Icon name="search" size={14} className="run-find-icon" />
      <Input
        ref={inputRef}
        className="run-find-input"
        value={query}
        placeholder={t('run.find.placeholder')}
        aria-label={t('run.find.placeholder')}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className={`run-find-count${results && results.total === 0 ? ' none' : ''}`}>
        {results === null
          ? ''
          : results.total === 0
            ? t('run.find.noResults')
            : results.index === null
              ? t('run.find.countMany', { total: results.total })
              : t('run.find.count', { n: results.index, total: results.total })}
      </span>
      <IconButton size="sm" icon={<Icon name="chevronUp" size={14} />} label={t('run.find.prev')} onClick={onPrev} />
      <IconButton size="sm" icon={<Icon name="chevronDown" size={14} />} label={t('run.find.next')} onClick={onNext} />
      <IconButton size="sm" icon={<Icon name="close" size={14} />} label={t('run.find.close')} onClick={onClose} />
    </div>
  )
}
