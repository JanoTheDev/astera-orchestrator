import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { filterSwitcherTabs, type SwitcherTab } from '../lib/tabSwitcher'
import { Button, Icon, Input, Kbd, Modal, cx, isTypeaheadKey, moveIndex, type ListMove } from './ui'
import './overlays.css'

/** One row of a PickList: its own content, picked by click, Enter or Space (each row is a ui Button). */
export interface PickRow {
  key: string
  content: React.ReactNode
  /** Marks the row the app shows now (the active tab). */
  current?: boolean
}

const MOVES: Record<string, ListMove> = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' }

/** The filter field's arrow keys for a PickList under it: Down enters the list one past the highlighted row and Up at
 *  its last row, the same rows the old in-field selection moved to. Returns true when it moved focus. */
export function pickListEnter(list: HTMLElement | null, key: string, sel: number, count: number): boolean {
  if (count === 0 || (key !== 'ArrowDown' && key !== 'ArrowUp')) return false
  const to = moveIndex(sel, new Array<boolean>(count).fill(false), key === 'ArrowDown' ? 'next' : 'prev')
  list?.querySelectorAll<HTMLElement>('[data-roving]')[to]?.focus()
  return true
}

/** A filtered pick list under a filter field (the quick switcher, the command bar's search). Built from ui Buttons with
 *  roving focus: one row is in the Tab order, arrows and Home/End move, Up on the first row and any typed character go
 *  back to the field. Local primitive, listed for promotion to ui (NOTES.md). */
export function PickList({
  rows,
  sel,
  onSel,
  onPick,
  field,
  label,
  empty,
  listRef
}: {
  rows: PickRow[]
  /** The highlighted row: Enter in the field picks it. */
  sel: number
  onSel: (i: number) => void
  onPick: (i: number) => void
  /** The filter field above the list. */
  field: React.RefObject<HTMLInputElement | null>
  label: string
  empty: string
  listRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (isTypeaheadKey(e) || e.key === 'Backspace') {
      field.current?.focus() // the character lands in the field
      return
    }
    const move = MOVES[e.key]
    if (move === undefined) return
    e.preventDefault()
    e.stopPropagation()
    if (move === 'prev' && at === 0) return field.current?.focus()
    items[moveIndex(at, new Array<boolean>(items.length).fill(false), move)]?.focus()
  }
  if (rows.length === 0) return <p className="ov-pick-empty">{empty}</p>
  return (
    <div ref={listRef} className="ov-pick" role="group" aria-label={label} onKeyDown={onKeyDown}>
      {rows.map((r, i) => (
        <Button
          key={r.key}
          variant="ghost"
          data-roving=""
          tabIndex={i === sel ? 0 : -1}
          aria-current={r.current || undefined}
          className={cx('ov-pick-row', i === sel && 'is-sel', r.current && 'is-current')}
          ref={i === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
          onMouseEnter={() => onSel(i)}
          onFocus={() => onSel(i)}
          onClick={() => onPick(i)}
        >
          {r.content}
        </Button>
      ))}
    </div>
  )
}

/** The key hints under a pick list: arrows move, Enter opens, Esc closes. */
export function PickKeys(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="ov-keys" aria-hidden="true">
      <span>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> {t('overlays.keys.move')}
      </span>
      <span>
        <Kbd>Enter</Kbd> {t('overlays.keys.open')}
      </span>
      <span>
        <Kbd>Esc</Kbd> {t('overlays.keys.close')}
      </span>
    </div>
  )
}

/** W7-F (#84): the quick tab switcher (`tabs.switcher`, Ctrl+Shift+P). Type to filter by tab, plan or Task name
 *  (filterSwitcherTabs), arrows move, Enter selects, Esc closes. */
export function QuickSwitcher({
  tabs,
  activeTabId,
  onSelect,
  onClose
}: {
  tabs: SwitcherTab[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const fieldRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => filterSwitcherTabs(tabs, query), [tabs, query])
  const pick = (tab: SwitcherTab | undefined): void => {
    if (!tab) return
    onSelect(tab.tabId)
    onClose()
  }
  return (
    <Modal title={t('overlays.switcher.title')} closeLabel={t('command.close')} onClose={onClose} footer={<PickKeys />}>
      <div className="ov-pick-field">
        <Icon name="search" className="ov-pick-field-icon" />
        <Input
          ref={fieldRef}
          autoFocus
          value={query}
          aria-label={t('overlays.switcher.title')}
          placeholder={t('tabs.switcher.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setAt(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') return // the Modal's own keys: Esc closes, Tab stays inside
            e.stopPropagation() // the app's own keys stay out of the filter
            if (e.key === 'Enter') pick(shown[at])
            else if (!pickListEnter(listRef.current, e.key, at, shown.length)) return
            e.preventDefault()
          }}
        />
      </div>
      <PickList
        rows={shown.map((tab) => ({
          key: tab.tabId,
          current: tab.tabId === activeTabId,
          content: (
            <>
              <span className="ov-pick-title">{tab.label ?? tab.title}</span>
              <span className="ov-pick-meta">
                {[tab.label ? tab.title : '', tab.taskTitle, tab.planName, tab.projectName].filter(Boolean).join(' · ')}
              </span>
            </>
          )
        }))}
        sel={at}
        onSel={setAt}
        onPick={(i) => pick(shown[i])}
        field={fieldRef}
        label={t('overlays.switcher.title')}
        empty={t('tabs.switcher.empty')}
        listRef={listRef}
      />
    </Modal>
  )
}
