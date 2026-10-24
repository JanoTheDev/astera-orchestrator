import { useEffect, useRef, useState } from 'react'
import type { MessageKey, MessageParams } from '../../../core/i18n'
import type { CliInstallStatus, McpAccess, McpClient, McpClientStatus, McpHttpSettings, McpHttpView } from '../../../core/types'
import {
  mcpHttpRegistrationLines,
  mcpRegistrationLines,
  shimPathFor,
  type McpRegistrationLine
} from '../../../core/install/mcpRegistration'
import type { McpHttpUrl } from '../../../core/mcp/httpUrls'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { useSetting } from '../hooks/useSetting'
import { invalidate } from '../lib/readCache'
import { Button, Checkbox, Input, Select } from './ui'

type Tr = (key: MessageKey, params?: MessageParams) => string

/** `read` with a toast when it fails; the rejection goes on, so a cached reader keeps the value it holds. */
function toastIfUnread<T>(read: Promise<T>, key: MessageKey, t: Tr): Promise<T> {
  return read.catch((err) => {
    toast.error(t(key, { detail: err instanceof Error ? err.message : String(err) }))
    throw err
  })
}

/** The saved value into `set`, or a toast when it cannot be read; the control then keeps its default. */
export function loadMcpAccess(
  set: (a: McpAccess) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  return toastIfUnread(window.api.settings.getMcpAccess(), 'settings.mcp.loadFailed', t).then(set, () => {})
}

/** The saved sessions value into `set`, or a toast when it cannot be read; the box then stays at its
 *  default (off) and the person is told it may not show what is saved. */
export function loadMcpSessions(
  set: (v: boolean) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  return toastIfUnread(window.api.settings.getMcpSessions(), 'settings.mcp.sessions.loadFailed', t).then(set, () => {})
}

/** The sessions checkbox does nothing while access is off (the Host refuses every call then). */
export function sessionsDisabled(access: McpAccess): boolean {
  return access === 'off'
}

/** Shows `next` at once, saves it, and puts `prev` back with a toast when the save fails. */
export function saveMcpSessions(
  next: boolean,
  prev: boolean,
  set: (v: boolean) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  set(next)
  return window.api.settings.setMcpSessions(next).catch((err) => {
    set(prev)
    toast.error(t('settings.mcp.sessions.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
  })
}

/** The saved GitHub-writes value into `set`, or a toast when it cannot be read; the box then stays at
 *  its default (off). */
export function loadMcpGithubWrite(
  set: (v: boolean) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  return toastIfUnread(window.api.settings.getMcpGithubWrite(), 'settings.mcp.githubWrite.loadFailed', t).then(set, () => {})
}

/** GitHub writes change things outside this machine, so the box is live only at Read and control. */
export function githubWriteDisabled(access: McpAccess): boolean {
  return access !== 'control'
}

/** Shows `next` at once, saves it, and puts `prev` back with a toast when the save fails. */
export function saveMcpGithubWrite(
  next: boolean,
  prev: boolean,
  set: (v: boolean) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  set(next)
  return window.api.settings.setMcpGithubWrite(next).catch((err) => {
    set(prev)
    toast.error(t('settings.mcp.githubWrite.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
  })
}

/** A registration line onto the clipboard, or a toast when the clipboard refuses it. */
export function copyLine(line: string, t: (key: MessageKey, params?: MessageParams) => string): Promise<void> {
  return navigator.clipboard.writeText(line).catch((err) => {
    toast.error(t('settings.mcp.copyFailed', { detail: err instanceof Error ? err.message : String(err) }))
  })
}

/** The client a registration row can register with from here; Cursor has no CLI to do it, so its row
 *  stays copy only. */
export function mcpClientFor(client: McpRegistrationLine['client']): McpClient | null {
  return client === 'Claude Code' ? 'claude' : client === 'Codex' ? 'codex' : null
}

export type RegisterView = { kind: 'label'; text: MessageKey } | { kind: 'button'; text: MessageKey; disabled: boolean }

/** What sits beside Copy for one client: nothing until its status is read, a label once Astera is
 *  registered with the same command, otherwise a button (disabled while it runs or when the client's
 *  CLI is not installed). */
export function registerViewFor(status: McpClientStatus | undefined, busy: boolean): RegisterView | null {
  if (status === undefined) return null
  if (busy) return { kind: 'button', text: 'settings.mcp.client.registering', disabled: true }
  switch (status.state) {
    case 'registered':
      return { kind: 'label', text: 'settings.mcp.client.registered' }
    case 'different':
      return { kind: 'button', text: 'settings.mcp.client.registerAgain', disabled: false }
    case 'absent':
      return { kind: 'button', text: 'settings.mcp.client.register', disabled: false }
    case 'not-installed':
      return { kind: 'button', text: 'settings.mcp.client.notInstalled', disabled: true }
  }
}

/** Each client's registration status into `set`, or a toast when it cannot be read; the rows then
 *  show Copy alone. */
export function loadMcpClients(
  set: (s: Record<McpClient, McpClientStatus>) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  return toastIfUnread(window.api.mcpClients.status(), 'settings.mcp.client.loadFailed', t).then(set, () => {})
}

/** Registers Astera with `client` through its CLI (main/mcpClients.ts), says how it went, and reads
 *  the status again either way. */
export async function registerClient(
  client: McpClient,
  name: string,
  t: (key: MessageKey, params?: MessageParams) => string,
  refresh: () => Promise<void>
): Promise<void> {
  const r = await window.api.mcpClients
    .register(client)
    .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
  if (r.ok) toast.success(t('settings.mcp.client.done', { client: name }))
  else toast.error(t('settings.mcp.client.failed', { client: name, detail: r.message }))
  await refresh()
}

/** What goes under the registration hint: nothing while the CLI status is unread, a hint to install
 *  the command first while it is not installed (a line naming a file that is not there cannot run),
 *  and once it is, the lines with the installed command by its full path (mcpRegistration.ts). */
export function registrationFor(
  status: CliInstallStatus | null,
  platform: string
): McpRegistrationLine[] | 'install-first' | null {
  if (status === null) return null
  if (!status.installed) return 'install-first'
  return mcpRegistrationLines({ platform, shimPath: shimPathFor({ platform, dir: status.dir }) })
}

/** The saved MCP over HTTP setting into `set`, or a toast when it cannot be read; the section then stays
 *  hidden rather than showing a default that may not be what is saved. */
export function loadMcpHttp(
  set: (v: McpHttpSettings) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  return toastIfUnread(window.api.settings.getMcpHttp(), 'settings.mcpHttp.loadFailed', t).then(set, () => {})
}

/** Shows `next` at once, saves it (main then sends `mcp-http-reload`), and puts `prev` back with a toast
 *  when the save fails. */
export function saveMcpHttp(
  next: McpHttpSettings,
  prev: McpHttpSettings,
  set: (v: McpHttpSettings) => void,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  set(next)
  return window.api.settings.setMcpHttp(next).catch((err) => {
    set(prev)
    toast.error(t('settings.mcpHttp.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
  })
}

/** Every control waits for a Host that runs the entrance (one that announced `mcp-http`): an older Host
 *  would never apply what is saved here, and the screen says so instead (Ruling 2). */
export function mcpHttpLocked(view: McpHttpView): boolean {
  return !view.host
}

/** The extra host names are allowed only while other devices are (host/mcpHttp.ts passes `--hosts` only then). */
export function mcpHttpHostsDisabled(view: McpHttpView, http: McpHttpSettings): boolean {
  return mcpHttpLocked(view) || !http.lan
}

/** The masked token: eight dots and the hint main gives (its last four characters), so a new token shows as
 *  a change while the window holds no token. */
export function maskToken(hint: string | null): string {
  return hint ? `${'•'.repeat(8)}${hint}` : ''
}

/** A port typed into the field: a whole number from 1 to 65535, else null. */
export function parsePort(text: string): number | null {
  const v = text.trim()
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

/** The host names typed into the field, split on commas and white space (a comma cannot be in one), without
 *  empties or repeats. */
export function parseHosts(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))]
}

/** The port and host-name fields' text for a setting: at load, and when a failed save puts the previous one back. */
export function mcpHttpFieldsOf(v: McpHttpSettings): { port: string; hosts: string } {
  return { port: String(v.port), hosts: v.hosts.join(', ') }
}

/** The line under the switch: that the Host is needed (not connected or not answering, or an older one), or
 *  the entrance's state (with the Host's error when it failed); nothing until the Host answered. */
export function mcpHttpStateLine(view: McpHttpView): { key: MessageKey; params?: MessageParams } | null {
  if (!view.host) return { key: `settings.mcpHttp.needsHost.${view.reason}` }
  const s = view.state
  if (!s) return null
  if (s.state === 'failed') return { key: 'settings.mcpHttp.state.failed', params: { detail: s.error ?? '' } }
  return { key: `settings.mcpHttp.state.${s.state}` }
}

/** The URLs other devices can use (the Host's list from the running process), while they are allowed and it runs;
 *  null when there is nothing to show, a child that named no addresses included. */
export function mcpHttpOthers(view: McpHttpView): McpHttpUrl[] | null {
  const s = view.host ? view.state : null
  return s?.state === 'running' && s.lan && s.urls ? s.urls : null
}

/** The URLs the client lines can use: the listed ones first, then 127.0.0.1; 127.0.0.1 alone while other
 *  devices are off; nothing until the entrance runs. */
export function mcpHttpLineChoices(view: McpHttpView): string[] {
  const s = view.host ? view.state : null
  if (s?.state !== 'running' || !s.url) return []
  return [...(mcpHttpOthers(view) ?? []).map((u) => u.url), s.url]
}

/** The URL the lines use: the one chosen while it is still offered, else the first. */
export function mcpHttpLineUrl(choices: string[], chosen: string | null): string | undefined {
  return chosen !== null && choices.includes(chosen) ? chosen : choices[0]
}

/** The HTTP registration lines as shown: the token masked from its hint, or the token itself while it is shown. */
export function mcpHttpShownLines(url: string, hint: string, shownToken: string | null): McpRegistrationLine[] {
  return mcpHttpRegistrationLines({ url, token: shownToken ?? maskToken(hint) })
}

/** The token file's content through main, or null (with a toast when the read failed). Asked for by a Show
 *  or a Copy only. */
export function readMcpHttpToken(t: (key: MessageKey, params?: MessageParams) => string): Promise<string | null> {
  return window.api.mcpHttp.token().catch((err) => {
    toast.error(t('settings.mcpHttp.tokenFailed', { detail: err instanceof Error ? err.message : String(err) }))
    return null
  })
}

/** The token's last four characters through main, or null when there is no token file yet (or, with a toast,
 *  when it could not be read). */
export function readMcpHttpTokenHint(t: (key: MessageKey, params?: MessageParams) => string): Promise<string | null> {
  return window.api.mcpHttp.tokenHint().catch((err) => {
    toast.error(t('settings.mcpHttp.tokenFailed', { detail: err instanceof Error ? err.message : String(err) }))
    return null
  })
}

/** One client's line onto the clipboard with the real token, read for this copy and not kept. Nothing is copied
 *  without a token file. */
export async function copyMcpHttpLine(
  client: McpRegistrationLine['client'],
  url: string,
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  const token = await readMcpHttpToken(t)
  const line = token ? mcpHttpRegistrationLines({ url, token }).find((l) => l.client === client)?.line : undefined
  if (line) await copyLine(line, t)
}

/** The token onto the clipboard, read for this copy and not kept. */
export async function copyMcpHttpToken(t: (key: MessageKey, params?: MessageParams) => string): Promise<void> {
  const token = await readMcpHttpToken(t)
  if (token) await copyLine(token, t)
}

/** Replaces the token through main and answers the new one's hint, or null with a toast. */
export function makeNewMcpHttpToken(t: (key: MessageKey, params?: MessageParams) => string): Promise<string | null> {
  return window.api.mcpHttp.newToken().catch((err) => {
    toast.error(t('settings.mcpHttp.newTokenFailed', { detail: err instanceof Error ? err.message : String(err) }))
    return null
  })
}

/** MCP access (MCP design M5): what an MCP client may do through `astera mcp serve`. The Host reads
 *  the saved value on every call, so the change applies to clients already connected.
 *
 *  `cliStatus` is the value CliSettings read and keeps after Install and Uninstall (App.tsx passes it
 *  on), so the lines follow those buttons without a second read. */
export function McpSettings({ cliStatus }: { cliStatus: CliInstallStatus | null }): React.JSX.Element {
  const { t } = useI18n()
  const registration = registrationFor(cliStatus, window.api.platform)
  const [access, setAccess] = useSetting<McpAccess>('mcpAccess', () => toastIfUnread(window.api.settings.getMcpAccess(), 'settings.mcp.loadFailed', t), 'control')
  const [sessions, setSessions] = useSetting('mcpSessions', () => toastIfUnread(window.api.settings.getMcpSessions(), 'settings.mcp.sessions.loadFailed', t), false)
  const [githubWrite, setGithubWrite] = useSetting('mcpGithubWrite', () => toastIfUnread(window.api.settings.getMcpGithubWrite(), 'settings.mcp.githubWrite.loadFailed', t), false)

  // Which clients already have Astera, read once the lines show (the CLI is installed) and again
  // after Install moves them; reading never runs the server (core/install/mcpClients.ts).
  const [registering, setRegistering] = useState<McpClient | null>(null)
  const linesShown = Array.isArray(registration)
  const [readClients, setClients] = useSetting(
    linesShown ? `mcpClients:${cliStatus?.dir}` : null,
    () => toastIfUnread(window.api.mcpClients.status(), 'settings.mcp.client.loadFailed', t)
  )
  const clients = readClients ?? null
  const refreshClients = (): Promise<void> => loadMcpClients(setClients, t)

  // Groups as direct children of the tab's .settings-stack, so the stack's gap separates the
  // access setting, the sessions and GitHub settings and the registration lines like neighbouring features.
  return (
    <>
      <div className="settings-group">
        <div className="settings-row">
          <span>{t('settings.mcp.label')}</span>
          <Select
            items={[
              { value: 'off', label: t('settings.mcp.off') },
              { value: 'read', label: t('settings.mcp.read') },
              { value: 'control', label: t('settings.mcp.control') }
            ]}
            value={access}
            onChange={(v) => {
              const next = v as McpAccess
              const prev = access
              setAccess(next)
              void window.api.settings.setMcpAccess(next).catch((err) => {
                setAccess(prev)
                toast.error(t('settings.mcp.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
              })
            }}
            ariaLabel={t('settings.mcp.label')}
          />
        </div>
        <span className="settings-hint">{t('settings.mcp.hint')}</span>
      </div>
      <div className="settings-group">
        <label className="settings-row">
          <span>{t('settings.mcp.sessions.label')}</span>
          <Checkbox
            checked={sessions}
            disabled={sessionsDisabled(access)}
            onChange={(v) => void saveMcpSessions(v, sessions, setSessions, t)}
          />
        </label>
        <span className="settings-hint">{t('settings.mcp.sessions.hint')}</span>
      </div>
      <div className="settings-group">
        <label className="settings-row">
          <span>{t('settings.mcp.githubWrite.label')}</span>
          <Checkbox
            checked={githubWrite}
            disabled={githubWriteDisabled(access)}
            onChange={(v) => void saveMcpGithubWrite(v, githubWrite, setGithubWrite, t)}
          />
        </label>
        <span className="settings-hint">{t('settings.mcp.githubWrite.hint')}</span>
      </div>
      {registration !== null && (
        <div className="settings-group">
          {/* The registration line for each client, in this platform's form (mcpRegistration.ts). Titled so it
              is not taken for the HTTP section's lines below: these start `astera mcp serve` on this computer. */}
          <div className="settings-row">
            <span>{t('settings.mcp.localTitle')}</span>
          </div>
          {registration === 'install-first' && <span className="settings-hint">{t('settings.mcp.installFirst')}</span>}
          {Array.isArray(registration) && (
            <>
              <span className="settings-hint">{t('settings.mcp.register')}</span>
              {registration.map(({ client, line }) => {
                const id = mcpClientFor(client)
                const view = id === null ? null : registerViewFor(clients?.[id], registering === id)
                return (
                  <div key={client} className="cli-path-hint">
                    <span className="mcp-register-client">{client}</span>
                    <code>{line}</code>
                    <Button variant="secondary" size="sm" onClick={() => void copyLine(line, t)}>{t('settings.cli.copy')}</Button>
                    {/* Runs the client's CLI only when pressed (main/mcpClients.ts). */}
                    {id !== null && view?.kind === 'label' && <span className="mcp-register-state">{t(view.text)}</span>}
                    {id !== null && view?.kind === 'button' && (
                      <Button variant="secondary" size="sm"
                        disabled={view.disabled || registering !== null}
                        title={clients?.[id].detail}
                        onClick={() => {
                          setRegistering(id)
                          void registerClient(id, client, t, refreshClients).finally(() => setRegistering(null))
                        }}
                      >
                        {t(view.text)}
                      </Button>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
      <McpHttpSection />
    </>
  )
}

/** MCP over HTTP (MCP HTTP design §4): the switch, the port, other devices with the host names they may
 *  use, and once the Host runs the entrance its URL, the token and the client lines. Every change is
 *  saved at once (the port and the names when the field is left) and main then sends `mcp-http-reload`;
 *  the state comes back on 'mcpHttp:state'. The window keeps only the token's last four characters; the
 *  token itself is read for a Show (and dropped on Hide) or for one Copy. */
function McpHttpSection(): React.JSX.Element | null {
  const { t } = useI18n()
  const [readHttp, setHttp] = useSetting('mcpHttp', () => toastIfUnread(window.api.settings.getMcpHttp(), 'settings.mcpHttp.loadFailed', t))
  const http = readHttp ?? null
  // A failed read of the status is a Host that does not run the entrance, not a missing answer.
  const [readView, setView] = useSetting<McpHttpView>('mcpHttpView', () => window.api.mcpHttp.status().catch(() => ({ host: false, reason: 'none' }) as McpHttpView))
  const view = readView ?? null
  const [readHint, setHint] = useSetting('mcpHttpTokenHint', () => readMcpHttpTokenHint(t))
  const hint = readHint ?? null
  const [shownToken, setShownToken] = useState<string | null>(null)
  const [portText, setPortText] = useState(() => (http ? mcpHttpFieldsOf(http).port : ''))
  const [hostsText, setHostsText] = useState(() => (http ? mcpHttpFieldsOf(http).hosts : ''))
  /** The URL picked for the client lines, kept while this screen is open (no setting). */
  const [chosenUrl, setChosenUrl] = useState<string | null>(null)
  /** The two text fields follow the setting, so a failed save that puts the previous setting back
   *  puts its port and names back in the fields too. */
  useEffect(() => {
    if (!readHttp) return
    const f = mcpHttpFieldsOf(readHttp)
    setPortText(f.port)
    setHostsText(f.hosts)
  }, [readHttp])

  // A push is newer than the status asked at mount (audit UI-14): setting the cache drops the read still in flight.
  useEffect(() => window.api.on('mcpHttp:state', setView), [])

  // The Host makes the token before it first starts the entrance (Ruling 3), so the hint is read again
  // whenever the state changes; a file left from before shows its hint while the entrance is off.
  const stateName = view?.host === true ? (view.state?.state ?? null) : null
  const hintRead = useRef(false)
  useEffect(() => {
    if (!hintRead.current) hintRead.current = true // the mount's own read is the cache's
    else invalidate('setting:mcpHttpTokenHint')
  }, [stateName])

  if (!http) return null
  const shown: McpHttpView = view ?? { host: false, reason: 'none' }
  // Locked until the Host's answer is in too, so nothing is saved toward a Host that may not apply it.
  const locked = view === null || mcpHttpLocked(shown)
  const stateLine = view === null ? null : mcpHttpStateLine(shown)
  const save = (next: McpHttpSettings): void => void saveMcpHttp(next, http, setHttp, t)
  const local = shown.host && shown.state?.state === 'running' ? shown.state.url : undefined
  const others = mcpHttpOthers(shown)
  const choices = mcpHttpLineChoices(shown)
  const url = mcpHttpLineUrl(choices, chosenUrl)

  const commitPort = (): void => {
    const port = parsePort(portText)
    if (port === null) {
      toast.error(t('settings.mcpHttp.portInvalid'))
      setPortText(String(http.port))
    } else if (port !== http.port) save({ ...http, port })
  }
  const commitHosts = (): void => {
    const hosts = parseHosts(hostsText)
    setHostsText(hosts.join(', '))
    if (hosts.join(',') !== http.hosts.join(',')) save({ ...http, hosts })
  }

  return (
    <div className="settings-group">
      <label className="settings-row">
        <span>{t('settings.mcpHttp.title')}</span>
        <Checkbox checked={http.enabled} disabled={locked} onChange={(v) => save({ ...http, enabled: v })} />
      </label>
      <span className="settings-hint">{t('settings.mcpHttp.hint')}</span>
      {stateLine && <span className="settings-hint mcp-http-state">{t(stateLine.key, stateLine.params)}</span>}
      <label className="settings-row">
        <span>{t('settings.mcpHttp.port')}</span>
        <Input
          type="text"
          inputMode="numeric"
          className="mcp-http-port"
          value={portText}
          disabled={locked}
          onChange={(e) => setPortText(e.target.value)}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
      <label className="settings-row">
        <span>{t('settings.mcpHttp.lan')}</span>
        <Checkbox checked={http.lan} disabled={locked} onChange={(v) => save({ ...http, lan: v })} />
      </label>
      <span className="settings-hint mcp-http-warning">{t('settings.mcpHttp.lanWarning')}</span>
      <label className="settings-row">
        <span>{t('settings.mcpHttp.hosts')}</span>
        <Input
          type="text"
          
          value={hostsText}
          disabled={locked || mcpHttpHostsDisabled(shown, http)}
          onChange={(e) => setHostsText(e.target.value)}
          onBlur={commitHosts}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
      <span className="settings-hint">{t('settings.mcpHttp.hostsHint')}</span>
      {local !== undefined && (
        <div className="cli-path-hint">
          <span className="mcp-register-client">{t('settings.mcpHttp.url')}</span>
          <code className="mcp-http-url">{local}</code>
          <Button variant="secondary" size="sm" onClick={() => void copyLine(local, t)}>{t('settings.cli.copy')}</Button>
        </div>
      )}
      {others !== null && (
        <>
          <span className="settings-hint">{t('settings.mcpHttp.others')}</span>
          {others.length === 0 && <span className="settings-hint mcp-http-others-none">{t('settings.mcpHttp.othersNone')}</span>}
          {others.map((u) => (
            <div key={u.url} className="cli-path-hint mcp-http-other">
              <span className="mcp-register-client">{t(`settings.mcpHttp.kind.${u.kind}`)}</span>
              <code>{u.url}</code>
              <Button variant="secondary" size="sm" onClick={() => void copyLine(u.url, t)}>{t('settings.cli.copy')}</Button>
            </div>
          ))}
          <span className="settings-hint">{t('settings.mcpHttp.othersHint')}</span>
        </>
      )}
      {!locked && (
        <div className="cli-path-hint">
          <span className="mcp-register-client">{t('settings.mcpHttp.token')}</span>
          <code className="mcp-http-token">{shownToken ?? (hint ? maskToken(hint) : t('settings.mcpHttp.tokenPending'))}</code>
          <Button variant="secondary" size="sm"
            className="mcp-http-reveal"
            disabled={hint === null && shownToken === null}
            onClick={() => {
              if (shownToken !== null) setShownToken(null)
              else void readMcpHttpToken(t).then(setShownToken)
            }}
          >
            {t(shownToken !== null ? 'settings.mcpHttp.hide' : 'settings.mcpHttp.reveal')}
          </Button>
          <Button variant="secondary" size="sm" className="mcp-http-copy-token" disabled={hint === null} onClick={() => void copyMcpHttpToken(t)}>
            {t('settings.cli.copy')}
          </Button>
          {/* No reload follows: the HTTP process re-reads the token file when its stamp changes, at the
              next request (Ruling 3). */}
          <Button variant="secondary" size="sm"
            className="mcp-http-new-token"
            title={t('settings.mcpHttp.newTokenHint')}
            disabled={!http.enabled}
            onClick={() =>
              void makeNewMcpHttpToken(t).then((v) => {
                if (!v) return
                setHint(v)
                setShownToken(null)
                toast.success(t('settings.mcpHttp.newTokenDone'))
              })
            }
          >
            {t('settings.mcpHttp.newToken')}
          </Button>
        </div>
      )}
      {url !== undefined && hint && (
        <>
          <span className="settings-hint">{t('settings.mcpHttp.lines')}</span>
          {choices.length > 1 && (
            <div className="cli-path-hint">
              <span className="mcp-register-client">{t('settings.mcpHttp.lineAddress')}</span>
              <Select
                items={choices.map((u) => ({ value: u, label: u }))}
                value={url}
                onChange={setChosenUrl}
                ariaLabel={t('settings.mcpHttp.lineAddress')}
              />
            </div>
          )}
          {mcpHttpShownLines(url, hint, shownToken).map(({ client, line }) => (
            <div key={client} className="cli-path-hint mcp-http-line">
              <span className="mcp-register-client">{client}</span>
              <code>{line}</code>
              <Button variant="secondary" size="sm" onClick={() => void copyMcpHttpLine(client, url, t)}>{t('settings.cli.copy')}</Button>
            </div>
          ))}
          <span className="settings-hint">{t('settings.mcpHttp.codexNote')}</span>
        </>
      )}
    </div>
  )
}
