import { useRef, useState } from 'react'
import type { RunConfigType } from '../../../core/run/types'
import type { MessageKey } from '../../../core/i18n'
import { runTypeIcon } from '../../../core/run/typeIcon'
import { useI18n } from '../i18n/I18nProvider'
import { FileIcon } from './FileIcon'
import { Button, Icon, IconButton, Input, Popover } from './ui'

/** Every kind modeled, in the order they are offered. `compound` is last and is never detected —
 *  nothing in a project's files implies one — so it always sits in the lower group. */
const ALL_TYPES: RunConfigType[] = [
  'shell', 'npm', 'node', 'gradle', 'maven', 'cargo', 'go', 'python', 'pytest', 'compose', 'dockerfile',
  'dotnet', 'compound'
]

/** The ＋ button and its popup for picking a new configuration's kind. A search box narrows the list
 *  (a substring of the kind's label or its type id); kinds already detected in this project (a seed of
 *  that kind exists in `configs` — RunConfigManager derives `detected` from that, since the seed's
 *  presence already came from scanning the project's own files) are grouped above the rest, the same
 *  role IntelliJ gives plugin-provided kinds over generic ones. */
export function RunTypePicker({
  detected,
  onPick
}: {
  detected: RunConfigType[]
  onPick: (type: RunConfigType) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const label = (ty: RunConfigType): string => t(`run.type.${ty}` as MessageKey)
  const q = query.trim().toLowerCase()
  const matches = (ty: RunConfigType): boolean => q === '' || label(ty).toLowerCase().includes(q) || ty.includes(q)

  const detectedSet = new Set(detected)
  const detectedList = ALL_TYPES.filter((ty) => detectedSet.has(ty) && matches(ty))
  const otherList = ALL_TYPES.filter((ty) => !detectedSet.has(ty) && matches(ty))

  const setOpenFresh = (next: boolean): void => {
    if (next) setQuery('')
    setOpen(next)
  }
  const pick = (ty: RunConfigType): void => {
    setOpen(false)
    onPick(ty)
  }
  const row = (ty: RunConfigType): React.JSX.Element => (
    <Button key={ty} variant="ghost" size="sm" data-roving="" className="rtp-item" icon={<FileIcon {...runTypeIcon(ty)} />} onClick={() => pick(ty)}>
      {label(ty)}
    </Button>
  )

  return (
    // Esc is taken here, before it bubbles to the dialog's own Esc-to-cancel: it closes only this popup
    // and gives focus back to the ＋ (the Popover's own Esc listener sits on the document, after the dialog).
    <div
      ref={rootRef}
      className="rtp-anchor"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus()
      }}
    >
      <Popover
        open={open}
        onOpenChange={setOpenFresh}
        label={t('run.manager.add')}
        panelClassName="rtp-menu"
        trigger={(p) => <IconButton {...p} size="sm" icon={<Icon name="add" size={14} />} label={t('run.manager.add')} />}
      >
        {/* data-roving on the search too: it is the Popover's first row, so it takes focus on open and
            ArrowDown moves from it to the first kind. Home/End stay with the text caret. */}
        <Input
          data-roving=""
          className="rtp-search"
          placeholder={t('run.picker.search')}
          aria-label={t('run.picker.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Home' || e.key === 'End') e.stopPropagation()
            else if (e.key === 'Enter') {
              const first = detectedList[0] ?? otherList[0]
              if (!first) return
              e.preventDefault()
              pick(first)
            }
          }}
        />
        {detectedList.length > 0 && (
          <>
            <div className="rtp-group" role="presentation">{t('run.picker.detected')}</div>
            {detectedList.map(row)}
          </>
        )}
        {otherList.length > 0 && (
          <>
            {detectedList.length > 0 && <div className="rtp-group" role="presentation">{t('run.picker.other')}</div>}
            {otherList.map(row)}
          </>
        )}
      </Popover>
    </div>
  )
}
