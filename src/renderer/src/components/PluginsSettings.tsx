import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginsCallAnswer } from '../../../core/types'
import type { SettingField } from '../../../core/plugins/settings'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { confirmModal, confirmModalWithChoices } from '../lib/confirm'
import { Select } from './Select'
import { configureChanges, configureDoneLine, failureLine, installPrompt, permissionLabel, reasonLine, statusLabel } from './pluginsText'

type Plugin = Record<string, unknown>
type Shown = { fields: SettingField[]; values: Record<string, unknown>; secrets: Record<string, unknown> }
type Draft = Record<string, string | boolean>

/** How often the list is read while the tab is open: a plugin's status (starting, a crash, failed) has no event yet. */
const LIST_EVERY_MS = 3_000
const LOG_LINES = 200

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const shownOf = (body: Record<string, unknown>): Shown => ({
  fields: Array.isArray(body.fields) ? (body.fields as SettingField[]) : [],
  values: isObject(body.values) ? body.values : {},
  secrets: isObject(body.secrets) ? body.secrets : {}
})
/** A call that threw (main gone, an IPC error) answers like one the Host refused, so every path says why. */
const failed = (e: unknown): PluginsCallAnswer => ({ ok: false, code: 'FAILED', message: e instanceof Error ? e.message : String(e) })
const without = <V,>(o: Record<string, V>, key: string): Record<string, V> => {
  const next = { ...o }
  delete next[key]
  return next
}

/** Settings › Plugins (plugin runtime design slice 2d, spec §30-31): the installed plugins, each with its status,
 *  version, capabilities and granted permissions, and Configure, Enable or Disable, Logs and Remove; installing a
 *  folder after the trust warning. Every check is the Host's: this shows what it answers. */
export function PluginsSettings(): React.JSX.Element {
  const { t } = useI18n()
  // Read through a ref by the timer, so a new `t` does not restart the list's clock.
  const tRef = useRef(t)
  tRef.current = t
  const [plugins, setPlugins] = useState<Plugin[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  /** The install button's state: a folder being read and shown, or the install itself. */
  const [installing, setInstalling] = useState<'idle' | 'reading' | 'installing'>('idle')
  /** Plugins with a change in flight. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<Record<string, 'settings' | 'logs'>>({})
  const [shown, setShown] = useState<Record<string, Shown>>({})
  /** What the person typed, by plugin: kept across the list's refreshes until it is saved (review focus 5). */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [clears, setClears] = useState<Record<string, ReadonlySet<string>>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const reading = useRef(false)
  const reload = useCallback(async (): Promise<void> => {
    if (reading.current) return
    reading.current = true
    try {
      const r = await window.api.plugins.list().catch(failed)
      // A list that cannot be read is said once, and the last one stays (review focus 1).
      if (!r.ok) return setListError(failureLine(r, tRef.current))
      setListError(null)
      setPlugins(Array.isArray(r.body.plugins) ? (r.body.plugins as Plugin[]).filter(isObject) : [])
    } finally {
      reading.current = false
    }
  }, [])
  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), LIST_EVERY_MS)
    return () => clearInterval(timer)
  }, [reload])

  const install = async (): Promise<void> => {
    if (installing !== 'idle') return
    const folder = await window.api.system.pickFolder()
    if (!folder) return
    setInstalling('reading')
    try {
      const seen = await window.api.plugins.inspect(folder).catch(failed)
      if (!seen.ok) return void toast.error(failureLine(seen, t))
      const answer = await confirmModalWithChoices(installPrompt(seen.body, folder, t))
      if (!answer.ok) return
      setInstalling('installing')
      // What was shown is what the Host checks the copy against (design P6).
      const r = await window.api.plugins
        .install({ path: folder, grant: answer.checked, expect: { name: str(seen.body.name), version: str(seen.body.version) } })
        .catch(failed)
      if (!r.ok) return void toast.error(failureLine(r, t))
      toast.success(t('settings.plugins.installed', { name: str(seen.body.displayName) || str(seen.body.id) }))
    } finally {
      setInstalling('idle')
      void reload()
    }
  }

  /** One change to one plugin at a time, then the list again. */
  const change = async (id: string, work: () => Promise<PluginsCallAnswer>, done?: (body: Record<string, unknown>) => void): Promise<void> => {
    if (busy.has(id)) return
    setBusy((s) => new Set(s).add(id))
    try {
      const r = await work().catch(failed)
      if (!r.ok) toast.error(failureLine(r, t))
      else done?.(r.body)
    } finally {
      setBusy((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      void reload()
    }
  }

  const remove = async (p: Plugin): Promise<void> => {
    const id = str(p.id)
    const name = str(p.displayName) || id
    const ok = await confirmModal({ title: t('settings.plugins.remove.title', { name }), body: t('settings.plugins.remove.body'), confirmLabel: t('settings.plugins.remove') })
    if (!ok) return
    await change(
      id,
      () => window.api.plugins.remove(id),
      (body) => {
        if (typeof body.warning === 'string') toast.error(t('settings.plugins.remove.left', { name, warning: body.warning }))
        else toast.success(t('settings.plugins.remove.done', { name }))
        setOpen((o) => without(o, id))
        setDrafts((d) => without(d, id))
        setClears((c) => without(c, id))
      }
    )
  }

  const readShown = async (id: string): Promise<void> => {
    const r = await window.api.plugins.settings(id).catch(failed)
    if (!r.ok) {
      toast.error(failureLine(r, t))
      return setOpen((o) => without(o, id))
    }
    setShown((s) => ({ ...s, [id]: shownOf(r.body) }))
  }
  const readLogs = async (id: string): Promise<void> => {
    const r = await window.api.plugins.logs(id, LOG_LINES).catch(failed)
    if (!r.ok) return void toast.error(failureLine(r, t))
    setLogs((l) => ({ ...l, [id]: list(r.body.lines) }))
  }
  const toggleOpen = (id: string, what: 'settings' | 'logs'): void => {
    if (open[id] === what) return setOpen((o) => without(o, id))
    setOpen((o) => ({ ...o, [id]: what }))
    void (what === 'settings' ? readShown(id) : readLogs(id))
  }

  const save = async (id: string): Promise<void> => {
    const view = shown[id]
    const changes = view ? configureChanges(view.fields, view, drafts[id] ?? {}, clears[id] ?? new Set()) : null
    if (!changes || saving !== null) return
    setSaving(id)
    try {
      const r = await window.api.plugins.configure(id, changes.set, changes.unset).catch(failed)
      // A refusal keeps what was typed, so the person can correct it.
      if (!r.ok) return void toast.error(failureLine(r, t))
      toast.success(configureDoneLine(r.body, t))
      setShown((s) => ({ ...s, [id]: shownOf(r.body) }))
      setDrafts((d) => without(d, id))
      setClears((c) => without(c, id))
    } finally {
      setSaving(null)
      void reload()
    }
  }

  return (
    <div className="settings-stack">
      <p className="settings-hint">{t('settings.plugins.hint')}</p>
      <div className="remote-actions">
        <button className="primary" disabled={installing !== 'idle'} onClick={() => void install()}>
          {installing === 'installing' ? t('settings.plugins.installing') : t('settings.plugins.installFolder')}
        </button>
      </div>
      {listError !== null && <p className="settings-hint is-warning">{listError}</p>}
      {plugins !== null && plugins.length === 0 && <p className="settings-hint">{t('settings.plugins.none')}</p>}
      {plugins?.map((p) => {
        const id = str(p.id)
        const view = shown[id]
        return (
          <div key={id} className="settings-group plugin-card">
            <PluginCard
              plugin={p}
              busy={busy.has(id)}
              onConfigure={() => toggleOpen(id, 'settings')}
              onToggle={(enabled) => void change(id, () => window.api.plugins.setEnabled(id, enabled))}
              onStartAgain={() => void change(id, () => window.api.plugins.setEnabled(id, true))}
              onRemove={() => void remove(p)}
              onLogs={() => toggleOpen(id, 'logs')}
            />
            {open[id] === 'settings' && view && (
              <PluginSettingsForm
                fields={view.fields}
                values={view.values}
                secrets={view.secrets}
                draft={drafts[id] ?? {}}
                clear={clears[id] ?? new Set()}
                onDraft={(key, v) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? {}), [key]: v } }))}
                onClear={(key, on) =>
                  setClears((c) => {
                    const next = new Set(c[id] ?? [])
                    if (on) next.add(key)
                    else next.delete(key)
                    return { ...c, [id]: next }
                  })
                }
                onSave={() => void save(id)}
                saving={saving === id}
                changed={configureChanges(view.fields, view, drafts[id] ?? {}, clears[id] ?? new Set()) !== null}
              />
            )}
            {open[id] === 'logs' && <PluginLogs lines={logs[id] ?? null} onRefresh={() => void readLogs(id)} />}
          </div>
        )
      })}
    </div>
  )
}

/** One installed plugin as spec §30 draws it. */
export function PluginCard({
  plugin,
  busy,
  onConfigure,
  onToggle,
  onStartAgain,
  onRemove,
  onLogs
}: {
  plugin: Record<string, unknown>
  /** A change to it is in flight: its buttons wait. */
  busy: boolean
  onConfigure: () => void
  onToggle: (enabled: boolean) => void
  /** A failed plugin stays failed until it is enabled again (design P11). */
  onStartAgain: () => void
  onRemove: () => void
  onLogs: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const id = str(plugin.id)
  const status = str(plugin.status)
  const enabled = plugin.enabled === true
  const capabilities = list(plugin.capabilities)
  const permissions = list(plugin.permissions)
  const reason = str(plugin.reason)
  return (
    <>
      <div className="plugin-head">
        <span className="plugin-name">{str(plugin.displayName) || id}</span>
        <span className={`plugin-status is-${status}`}>{statusLabel(status, t)}</span>
      </div>
      <span className="settings-hint">
        {id} · {t('settings.plugins.version', { version: str(plugin.version) })}
      </span>
      {str(plugin.description) !== '' && <span className="settings-hint">{str(plugin.description)}</span>}
      {reason !== '' && <span className={`settings-hint${status === 'failed' || status === 'incompatible' ? ' is-warning' : ''}`}>{reasonLine(reason, t)}</span>}
      {capabilities.length > 0 && (
        <div className="plugin-facts">
          <span className="settings-field-label">{t('settings.plugins.capabilities')}</span>
          <span>{capabilities.join(', ')}</span>
        </div>
      )}
      <div className="plugin-facts">
        <span className="settings-field-label">{t('settings.plugins.permissions')}</span>
        <span>
          {permissions.length === 0
            ? t('settings.plugins.noPermissions')
            : permissions.map((p, i) => (
                <span key={p} title={p}>
                  {i > 0 ? ', ' : ''}
                  {permissionLabel(p, t)}
                </span>
              ))}
        </span>
      </div>
      <div className="remote-actions">
        <button className="settings-gen-refresh" disabled={busy} onClick={onConfigure}>
          {t('settings.plugins.configure')}
        </button>
        {status === 'failed' && (
          <button className="settings-gen-refresh" disabled={busy} onClick={onStartAgain}>
            {t('settings.plugins.startAgain')}
          </button>
        )}
        <button className="settings-gen-refresh" disabled={busy} onClick={() => onToggle(!enabled)}>
          {enabled ? t('settings.plugins.disable') : t('settings.plugins.enable')}
        </button>
        <button className="settings-gen-refresh" onClick={onLogs}>
          {t('settings.plugins.logs')}
        </button>
        <button className="ghost danger" disabled={busy} onClick={onRemove}>
          {t('settings.plugins.remove')}
        </button>
      </div>
    </>
  )
}

/** The form spec §24 asks Astera to make from a plugin's settings schema. A secret is never shown (§23): its box is
 *  empty, says whether one is set, and is cleared only by its own checkbox. */
export function PluginSettingsForm({
  fields,
  values,
  secrets,
  draft,
  clear,
  onDraft,
  onClear,
  onSave,
  saving,
  changed
}: {
  fields: readonly SettingField[]
  values: Record<string, unknown>
  secrets: Record<string, unknown>
  /** What the person typed; a field not in it shows what is stored. */
  draft: Draft
  clear: ReadonlySet<string>
  onDraft: (key: string, value: string | boolean) => void
  onClear: (key: string, on: boolean) => void
  onSave: () => void
  saving: boolean
  changed: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  if (fields.length === 0) return <p className="settings-hint">{t('settings.plugins.form.none')}</p>
  const textOf = (f: SettingField): string =>
    typeof draft[f.key] === 'string' ? (draft[f.key] as string) : values[f.key] === undefined ? '' : String(values[f.key])
  const defaultLine = (f: SettingField): string => (f.default === undefined ? '' : t('settings.plugins.form.default', { value: String(f.default) }))
  return (
    <div className="plugin-form">
      {fields.map((f) => {
        const label = (
          <span className="plugin-field-label">
            {f.title ?? f.key}
            {f.required && <span className="plugin-required">{t('settings.plugins.form.required')}</span>}
          </span>
        )
        const set = secrets[f.key] === 'set'
        return (
          <div key={f.key} className="plugin-field">
            {f.type === 'boolean' ? (
              <label className="check-small">
                <input
                  type="checkbox"
                  checked={typeof draft[f.key] === 'boolean' ? (draft[f.key] as boolean) : values[f.key] === true}
                  onChange={(e) => onDraft(f.key, e.target.checked)}
                />
                {label}
              </label>
            ) : (
              label
            )}
            {f.description !== undefined && <span className="settings-hint">{f.description}</span>}
            {f.secret ? (
              <div className="remote-actions">
                <input
                  type="password"
                  className="settings-gen-input remote-actions-grow"
                  aria-label={f.title ?? f.key}
                  value={typeof draft[f.key] === 'string' ? (draft[f.key] as string) : ''}
                  placeholder={set ? t('settings.plugins.form.secretPlaceholder') : t('settings.plugins.form.secretPlaceholderNew')}
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={clear.has(f.key)}
                  onChange={(e) => onDraft(f.key, e.target.value)}
                />
                <span className="settings-hint">{set ? t('settings.plugins.form.secretSet') : t('settings.plugins.form.secretUnset')}</span>
                {set && (
                  <label className="check-small">
                    <input type="checkbox" checked={clear.has(f.key)} onChange={(e) => onClear(f.key, e.target.checked)} />
                    <span>{t('settings.plugins.form.clear')}</span>
                  </label>
                )}
              </div>
            ) : f.enum ? (
              <Select
                className="settings-gen-select"
                ariaLabel={f.title ?? f.key}
                value={textOf(f)}
                onChange={(v) => onDraft(f.key, v)}
                items={[{ value: '', label: t('settings.plugins.form.notSet') }, ...f.enum.map((v) => ({ value: String(v), label: String(v) }))]}
              />
            ) : f.type !== 'boolean' ? (
              <input
                type="text"
                className="settings-gen-input"
                aria-label={f.title ?? f.key}
                inputMode={f.type === 'string' ? undefined : 'decimal'}
                value={textOf(f)}
                placeholder={defaultLine(f)}
                spellCheck={false}
                onChange={(e) => onDraft(f.key, e.target.value)}
              />
            ) : null}
          </div>
        )
      })}
      <div className="remote-actions is-end">
        <button className="primary" disabled={!changed || saving} onClick={onSave}>
          {t('settings.plugins.form.save')}
        </button>
      </div>
    </div>
  )
}

/** The tail of a plugin's log, its secrets already redacted by the Host (design P13). */
export function PluginLogs({ lines, onRefresh }: { lines: string[] | null; onRefresh: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])
  return (
    <div className="plugin-logs">
      <div className="remote-actions is-end">
        <button className="settings-gen-refresh" onClick={onRefresh}>
          {t('settings.plugins.logs.refresh')}
        </button>
      </div>
      {lines !== null && (lines.length === 0 ? <p className="settings-hint">{t('settings.plugins.logs.none')}</p> : <pre ref={box} className="plugin-log">{lines.join('\n')}</pre>)}
    </div>
  )
}
