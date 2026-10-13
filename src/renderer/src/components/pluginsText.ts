// The sentences Settings › Plugins shows (plugin runtime design slice 2d), apart from the component so each is tested
// as text: a permission and a status in words, the install warning (spec §31), what a settings form changed (§23-24),
// how a plugin stands after a save, and why a call came back with nothing.
import type { MessageKey, MessageParams } from '../../../core/i18n'
import type { SettingField } from '../../../core/plugins/settings'

type T = (key: MessageKey, params?: MessageParams) => string

const PERMISSIONS: Record<string, MessageKey> = {
  'projects.read': 'settings.plugins.perm.projects.read',
  'jobs.read': 'settings.plugins.perm.jobs.read',
  'jobs.create': 'settings.plugins.perm.jobs.create',
  'jobs.run': 'settings.plugins.perm.jobs.run',
  'runs.read': 'settings.plugins.perm.runs.read',
  'runs.control': 'settings.plugins.perm.runs.control',
  'tasks.read': 'settings.plugins.perm.tasks.read',
  'tasks.write': 'settings.plugins.perm.tasks.write',
  'questions.read': 'settings.plugins.perm.questions.read',
  'questions.answer': 'settings.plugins.perm.questions.answer',
  'completion.read': 'settings.plugins.perm.completion.read',
  'events.subscribe': 'settings.plugins.perm.events.subscribe',
  'github.read': 'settings.plugins.perm.github.read',
  'github.write': 'settings.plugins.perm.github.write',
  'how-it-works.read': 'settings.plugins.perm.how-it-works.read'
}

const STATUSES: Record<string, MessageKey> = {
  running: 'settings.plugins.status.running',
  starting: 'settings.plugins.status.starting',
  stopped: 'settings.plugins.status.stopped',
  failed: 'settings.plugins.status.failed',
  disabled: 'settings.plugins.status.disabled',
  incompatible: 'settings.plugins.status.incompatible'
}

/** A permission in words; one this app does not know (a newer Host's) by its name. */
export const permissionLabel = (p: string, t: T): string => (Object.hasOwn(PERMISSIONS, p) ? t(PERMISSIONS[p]) : p)

export const statusLabel = (s: string, t: T): string => (Object.hasOwn(STATUSES, s) ? t(STATUSES[s]) : s)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The install warning (spec §31) for what `plugins.inspect` answered about `folder`: one checked choice a permission
 *  (unchecking one grants the rest, design P6), and the trust sentence last. */
export function installPrompt(
  inspection: Record<string, unknown>,
  folder: string,
  t: T
): { title: string; body: string; confirmLabel: string; choices: { id: string; label: string; hint: string; defaultChecked: true }[] } {
  const permissions = list(inspection.permissions)
  const capabilities = list(inspection.capabilities)
  const installed = inspection.installed as { version?: unknown } | undefined
  const lines = [
    t('settings.plugins.install.what', { id: str(inspection.id), version: str(inspection.version) }),
    t('settings.plugins.install.from', { folder }),
    ...(installed && typeof installed.version === 'string' ? [t('settings.plugins.install.replaces', { version: installed.version })] : []),
    ...(str(inspection.description) !== '' ? [str(inspection.description)] : []),
    ...(capabilities.length > 0 ? [t('settings.plugins.install.capabilities', { list: capabilities.join(', ') })] : []),
    ...(inspection.compatible === false ? [t('settings.plugins.install.incompatible', { reason: str(inspection.reason) })] : []),
    permissions.length > 0 ? t('settings.plugins.install.uncheck') : t('settings.plugins.install.noPermissions'),
    '',
    t('settings.plugins.install.trust')
  ]
  return {
    title: t('settings.plugins.install.title', { name: str(inspection.displayName) || str(inspection.id) }),
    body: lines.join('\n'),
    confirmLabel: t('settings.plugins.install.button'),
    choices: permissions.map((p) => ({ id: p, label: permissionLabel(p, t), hint: p, defaultChecked: true as const }))
  }
}

/** What a settings form changed, as `plugins.configure` takes it, or null when nothing did. `draft` holds only what the
 *  person touched. An emptied field goes back to its default (unset), unless it showed that default already. A secret
 *  is never shown (spec §23): its empty box leaves it as it is, and only `clear` unsets it. */
export function configureChanges(
  fields: readonly SettingField[],
  shown: { values: Record<string, unknown>; secrets: Record<string, unknown> },
  draft: Record<string, string | boolean>,
  clear: ReadonlySet<string>
): { set: Record<string, string | boolean>; unset: string[] } | null {
  const set: Record<string, string | boolean> = {}
  const unset: string[] = []
  for (const f of fields) {
    const has = Object.hasOwn(draft, f.key)
    if (f.secret) {
      if (clear.has(f.key)) {
        if (shown.secrets[f.key] === 'set') unset.push(f.key)
      } else if (has && typeof draft[f.key] === 'string' && draft[f.key] !== '') set[f.key] = draft[f.key]
      continue
    }
    if (!has) continue
    const v = draft[f.key]
    const current = shown.values[f.key]
    if (f.type === 'boolean') {
      if (typeof v === 'boolean' && v !== current) set[f.key] = v
      continue
    }
    const text = String(v)
    if (current !== undefined && text === String(current)) continue
    if (text.trim() === '') {
      if (current !== undefined && current !== f.default) unset.push(f.key)
      continue
    }
    set[f.key] = text
  }
  return Object.keys(set).length > 0 || unset.length > 0 ? { set, unset } : null
}

/** How the plugin stands after a save (`plugins.configure`'s status, reason and restarted). */
export function configureDoneLine(body: Record<string, unknown>, t: T): string {
  if (body.restarted === true) return t('settings.plugins.done.restarted')
  switch (body.status) {
    case 'running':
    case 'starting':
      return t('settings.plugins.done.starting')
    case 'failed':
      return t('settings.plugins.done.failed')
    case 'disabled':
      return t('settings.plugins.done.disabled')
    default:
      return typeof body.reason === 'string' ? t('settings.plugins.done.held', { reason: body.reason }) : t('settings.plugins.done.saved')
  }
}

/** The Host's reason a plugin does not run, as the tab shows it. A held-back plugin's names the settings it needs and
 *  points at the CLI (manager.ts `heldBack`); beside a Configure button it says that instead. Any other reason is the
 *  Host's, or the plugin's own words, as they came. */
export function reasonLine(reason: string, t: T): string {
  const held = /^needs settings: ([^;]+); set them with astera plugins configure\b/.exec(reason)
  return held ? t('settings.plugins.needsSettings', { keys: held[1] }) : reason
}

/** Why a call came back with nothing: in the app's words when no Host answered or it runs no plugins, else the Host's
 *  own sentence. */
export function failureLine(r: { ok: false; code: string; message: string }, t: T): string {
  switch (r.code) {
    case 'HOST_NOT_RUNNING':
      return t('settings.plugins.fail.noHost')
    case 'NOT_SUPPORTED':
      return t('settings.plugins.fail.notSupported', { message: r.message })
    case 'TIMEOUT':
      return t('settings.plugins.fail.timeout')
    case 'HOST_LOST':
      return t('settings.plugins.fail.lost')
    default:
      return r.message
  }
}
