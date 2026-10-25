import type { RunConfig, RunStatus } from '../../../core/types'
import type { MessageKey } from '../../../core/i18n'
import { groupConfigs } from '../../../core/run/grouping'
import { recentConfigIds, configRowStatus, type RowStatus } from '../../../core/run/menuRows'
import { formatRunDuration } from '../../../core/run/duration'
import { runTypeIcon } from '../../../core/run/typeIcon'
import { isSeedId } from '../../../core/run/draft'
import { exitWording } from '../../../core/sessions/exitWording'
import { useI18n } from '../i18n/I18nProvider'
import { FileIcon } from './FileIcon'
import { Button, Icon, IconButton, Popover } from './ui'

/** How many configurations the Recent group shows. */
const RECENT_LIMIT = 5

/** The toolbar's configuration control: a pill that says what is selected and whether it is running,
 *  and a menu to change it.
 *
 *  It replaces a plain Select, which could show a name and nothing else. What this adds is what the
 *  Run/Debug widget in an IDE adds: the state of the thing you are about to press ▶ on, a way to reach
 *  what you just ran, and a ▶ on each row so choosing and running is one gesture rather than two.
 *
 *  `open` is controlled: a shortcut (run.selectConfig) opens this from outside the component.
 *
 *  **A configuration in Recent also stays in its own group** — it appears twice. Removing it would
 *  take a configuration out of the folder its author filed it in the moment they ran it; the Recent
 *  heading is what explains the second appearance. */
export function RunConfigMenu({
  configs,
  runs,
  selectedId,
  open,
  onOpenChange,
  onSelect,
  onRun,
  onStop,
  onEdit,
  onManage,
  shortcut
}: {
  configs: RunConfig[]
  /** The current project's runs, finished ones included — Recent and every row's status read this. */
  runs: RunStatus[]
  selectedId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  /** The row's inline ▶. It selects as well as runs: leaving the selection behind would put the pill
   *  on one configuration while another one runs. */
  onRun: (id: string) => void
  /** A running config's row ⏹: stops that run. */
  onStop: (runId: string) => void
  /** The row's ✎ — every row, not just the selected one (the footer's Edit row stays for the selected). */
  onEdit: (id: string) => void
  onManage: () => void
  /** run.selectConfig's binding, already formatted — this is what opens the pill, so the pill's title
   *  is where the shortcut belongs, not the "Manage run configurations…" footer row below (that opens
   *  the manager, a different action). Undefined when the user cleared every binding for it. */
  shortcut?: string
}): React.JSX.Element {
  const { t } = useI18n()
  const byId = new Map(configs.map((c) => [c.id, c]))
  const selected = selectedId ? byId.get(selectedId) : undefined
  const selectedStatus = selectedId ? configRowStatus(runs, selectedId) : null
  const now = Date.now()

  /** A row's right-hand text. The exit code and the duration come from the two the run tab strip
   *  already uses — the same fact must not read differently in two places. */
  const statusText = (s: RowStatus | null): string | null => {
    if (!s) return null
    if (s.kind === 'running') return t('run.menu.running', { count: s.count })
    const wording = exitWording(s.run.exitCode, { closedByAstera: s.run.closedByAstera, closeReason: s.run.closeReason })
    const code = t(wording.key, wording.params)
    return `${code} · ${formatRunDuration(s.run, now)}`
  }

  const recent = recentConfigIds(runs, RECENT_LIMIT)
    .map((id) => byId.get(id))
    .filter((c): c is RunConfig => !!c)

  // Computed once and rendered from here: the rows are drawn in this order, which is also the order
  // ↑↓ moves focus through (Popover's arrows walk the [data-roving] rows in document order).
  const groups = groupConfigs(configs)

  // Close-on-outside-click, Esc (focus back to the pill) and ↑↓ over the rows come from the Popover —
  // a menu a shortcut opens (run.selectConfig) and that then needs a mouse is not finished. On open
  // the first row takes focus, so the arrows work at once also when the shortcut opened it; Enter or
  // Space on a focused row picks it (a native button), and Tab reaches each row's ▶ in turn.

  const row = (c: RunConfig, key: string): React.JSX.Element => {
    const s = configRowStatus(runs, c.id)
    const text = statusText(s)
    // A live run reads with the same accent the pill's dot uses; a failed one reads with the same
    // colour the tab strip's own exit tag does (.run-tab-exit.fail) — the same fact must not read
    // differently in two places.
    const statusClass = s?.kind === 'running' ? ' live' : s?.kind === 'exited' && exitWording(s.run.exitCode, { closedByAstera: s.run.closedByAstera, closeReason: s.run.closeReason }).tone === 'danger' ? ' fail' : ''
    return (
      <div className={`rcmenu-row${c.id === selectedId ? ' on' : ''}`} key={key}>
        <Button
          variant="ghost"
          size="sm"
          data-roving=""
          aria-current={c.id === selectedId ? 'true' : undefined}
          className="rcmenu-pick"
          icon={<FileIcon {...runTypeIcon(c.type)} />}
          onClick={() => {
            onSelect(c.id)
            onOpenChange(false)
          }}
        >
          <span className="rcmenu-name">{c.name}</span>
          {isSeedId(c.id) && <span className="rcmenu-tag">{t('run.menu.detected')}</span>}
          {c.temporary && (
            <span className="rcmenu-tag" title={t('run.manager.markTemporary')}>
              {t('run.menu.temporary')}
            </span>
          )}
          {text && <span className={`rcmenu-status${statusClass}`}>{text}</span>}
        </Button>
        {s?.kind === 'running' && (
          <IconButton
            size="sm"
            icon={<Icon name="stop" size={14} />}
            label={`${t('run.action.stop')}: ${c.name}`}
            onClick={() => {
              runs.filter((r) => r.configId === c.id && r.status === 'running').forEach((r) => onStop(r.runId))
              onOpenChange(false)
            }}
          />
        )}
        <IconButton
          size="sm"
          icon={<Icon name="edit" size={14} />}
          label={`${t('run.row.edit')}: ${c.name}`}
          onClick={() => {
            onOpenChange(false)
            onEdit(c.id)
          }}
        />
        <IconButton
          size="sm"
          className="rcmenu-run"
          icon={<Icon name="run" size={14} />}
          label={`${t('run.action.run')}: ${c.name}`}
          onClick={() => {
            onRun(c.id)
            onOpenChange(false)
          }}
        />
      </div>
    )
  }

  const pillLabel = t('run.config.selectLabel')
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      label={pillLabel}
      className="rcmenu"
      panelClassName="rcmenu-menu"
      trigger={(p) => (
        <Button
          {...p}
          variant="ghost"
          size="sm"
          className="rcmenu-pill"
          aria-label={pillLabel}
          title={shortcut ? `${pillLabel} (${shortcut})` : pillLabel}
          icon={selected ? <FileIcon {...runTypeIcon(selected.type)} /> : undefined}
        >
          {selected ? (
            <>
              <span className="rcmenu-pill-name">{selected.name}</span>
              {selectedStatus?.kind === 'running' && (
                <>
                  <span className="rcmenu-live" role="img" aria-label={t('run.menu.running', { count: selectedStatus.count })} />
                  {selectedStatus.count > 1 && <span className="rcmenu-count">{selectedStatus.count}</span>}
                </>
              )}
            </>
          ) : (
            <span className="rcmenu-pill-name">{t('run.config.none')}</span>
          )}
          <Icon name="chevronDown" size={14} />
        </Button>
      )}
    >
      {recent.length > 0 && (
        <>
          <div className="rcmenu-group" role="presentation">{t('run.menu.recent')}</div>
          {recent.map((c) => row(c, `recent:${c.id}`))}
        </>
      )}
      {groups.map((g) => (
        <div key={`${g.kind}:${g.key}`}>
          <div className="rcmenu-group" role="presentation">
            {g.kind === 'folder' ? g.key : t(`run.type.${g.key}` as MessageKey)}
          </div>
          {g.items.map((c) => row(c, c.id))}
        </div>
      ))}
      <div className="rcmenu-sep" />
      {selected && (
        <Button
          variant="ghost"
          size="sm"
          data-roving=""
          className="rcmenu-foot"
          onClick={() => {
            onOpenChange(false)
            onEdit(selected.id)
          }}
        >
          {t('run.menu.edit', { name: selected.name })}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        data-roving=""
        className="rcmenu-foot"
        onClick={() => {
          onOpenChange(false)
          onManage()
        }}
      >
        {t('run.manager.open')}
      </Button>
    </Popover>
  )
}
