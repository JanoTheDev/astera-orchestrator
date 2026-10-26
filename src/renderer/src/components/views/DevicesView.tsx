// The Devices side bar view (DESIGN-W13 §4): This computer (whether it takes work from other devices), Your devices
// (the paired Runtimes, online or not; a click opens the device's `view:device` tab) and Found on your network (the
// found devices not paired yet, each with an inline Add). The Add device modal opens from here.
import { useEffect, useRef, useState } from 'react'
import { parseViewTab } from '../../../../core/panes/tabId'
import { confirmModal } from '../../lib/confirm'
import { toast } from '../../lib/toast'
import { Button, Icon, IconButton, Menu, Switch, Tree, ViewContainer, ViewPane, menuPointOf, type MenuItem, type TreeItem } from '../ui'
import { openSettings, openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { controlFailureLine, failureLine, pingLine } from '../remoteRuntimesText'
import { AddDeviceModal } from '../devices/AddDeviceModal'
import { acceptsWork, deviceActions, deviceState, FOUND_ACTIONS, foundNotPaired, needsAttention, osName, sourceLabel } from '../devices/devicesView'
import { closeAddDevice, openAddDevice, refreshDevices, startDiscovery, useDevices } from '../devices/useDevices'
import '../devices/devices.css'

const STATE_ICON = { online: 'done', offline: 'serverOff', unknown: 'pending' } as const
const THIS = 'this'

export function DevicesView(p: SideBarViewProps): React.JSX.Element {
  const { t } = p
  const { paired, accountsOf, mine, found, adding } = useDevices()
  useEffect(() => {
    startDiscovery()
    refreshDevices(false)
  }, [])
  const toFind = foundNotPaired(found)
  const openDevice = (runtimeId: string): void => openView('device', runtimeId)
  const remoteSettings = (): void => openSettings('integrations', 'remote')
  const yours = useClickOpen(openDevice)
  const thisClick = useClickOpen(remoteSettings)

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<MenuItem | 'separator'> } | null>(null)
  const [switching, setSwitching] = useState(false)
  const fail = (err: unknown): void => void toast.error(err instanceof Error ? err.message : String(err))
  const check = async (runtimeId: string): Promise<void> => {
    try {
      const res = await window.api.remote.ping(runtimeId)
      ;(res.ok ? toast.success : toast.error)(pingLine(res, t as never))
      refreshDevices()
    } catch (err) {
      fail(err)
    }
  }
  const forget = async (runtimeId: string, name: string): Promise<void> => {
    const ok = await confirmModal({ title: t('devices.unpair.title'), body: t('devices.unpair.body', { name }), confirmLabel: t('devices.unpair.button'), danger: true })
    if (!ok) return
    try {
      const done = await window.api.remote.remove(runtimeId)
      if (!done.ok) toast.error(failureLine(done, t as never))
    } catch (err) {
      fail(err)
    }
    refreshDevices()
    p.setPairedChanged((n) => n + 1)
  }
  // Remote on listens on this computer's first address (private IPv4 first), as Settings › Remote Runtimes offers; off asks first.
  const setAccepting = async (on: boolean): Promise<void> => {
    setSwitching(true)
    try {
      if (on) {
        const listen = (await window.api.remote.addresses())[0]?.address
        if (!listen) return void toast.error(t('devices.this.noAddress'))
        const r = await window.api.remote.start(listen)
        if (!r.ok) return void toast.error(controlFailureLine(r, 'start', t as never))
        toast.success(t('settings.remote.start.done', { listen: String(r.body.listen ?? listen), port: String(r.body.port ?? '') }))
      } else {
        const ok = await confirmModal({ title: t('settings.remote.stop.title'), body: t('settings.remote.stop.body'), confirmLabel: t('settings.remote.stop.button'), danger: true })
        if (!ok) return
        const r = await window.api.remote.stop()
        if (!r.ok) return void toast.error(controlFailureLine(r, 'stop', t as never))
        toast.success(t('settings.remote.stop.done'))
      }
    } catch (err) {
      fail(err)
    } finally {
      setSwitching(false)
      refreshDevices()
    }
  }

  const accepts = acceptsWork(mine)
  const thisRows: TreeItem[] = [
    {
      id: THIS,
      depth: 0,
      label: t('devices.thisComputer'),
      title: mine ? `${t('devices.thisComputer')}\n${t(accepts ? 'devices.this.accepts' : 'devices.this.off')}` : undefined,
      icon: <Icon name="laptop" size={16} />,
      description: mine === undefined ? '' : mine === null ? t('devices.this.unknown') : t(accepts ? 'devices.this.acceptsShort' : 'devices.this.offShort'),
      actions: (
        <>
          <Switch checked={accepts} disabled={!mine || switching} aria-label={t('devices.this.acceptLabel')} onChange={(on) => void setAccepting(on)} />
          <IconButton size="sm" icon={<Icon name="settings" size={14} />} label={t('devices.this.settings')} onClick={remoteSettings} />
        </>
      )
    }
  ]
  const pairedRows: TreeItem[] = (paired ?? []).map((r) => {
    const state = deviceState(r)
    const accounts = accountsOf[r.runtimeId]
    const os = found.find((f) => f.paired === r.runtimeId)?.os
    return {
      id: r.runtimeId,
      depth: 0,
      label: r.name,
      title: `${r.name}\n${r.address}:${r.port}\n${t(`devices.state.${state}`)}`,
      icon: <Icon name={STATE_ICON[state]} size={16} />,
      description: osName(os),
      actions: (
        <IconButton
          size="sm"
          icon={<Icon name="refresh" size={14} />}
          label={t(state === 'offline' ? 'devices.menu.retry' : 'devices.menu.check')}
          onClick={() => void check(r.runtimeId)}
        />
      ),
      decoration: needsAttention(r, accounts)
        ? { icon: <Icon name="warning" size={14} />, text: t(state === 'offline' ? 'devices.state.offline' : 'devices.account.needsSignIn'), tone: 'warn' }
        : accounts && accounts.length > 0
          ? { text: t('devices.accountCount', { count: accounts.length }) }
          : undefined
    }
  })
  const foundRows: TreeItem[] = toFind.map((f) => ({
    id: f.key,
    depth: 0,
    label: f.name,
    title: `${f.name}\n${f.address}`,
    icon: <Icon name="web" size={16} />,
    description: `${f.address} · ${sourceLabel(f)}`,
    actions: <IconButton size="sm" icon={<Icon name="add" size={14} />} label={t('devices.addNamed', { name: f.name })} onClick={() => openAddDevice(f)} />
  }))
  const addFound = (key: string): void => {
    const f = toFind.find((x) => x.key === key)
    if (f) openAddDevice(f)
  }

  const open = (e: React.MouseEvent, items: Array<MenuItem | 'separator'>): void => {
    e.preventDefault()
    setMenu({ at: menuPointOf(e), items })
  }
  const thisMenu = (): Array<MenuItem | 'separator'> => [
    { id: 'accept', label: t('devices.this.acceptLabel'), checked: accepts, disabled: !mine || switching, onSelect: () => void setAccepting(!accepts) },
    { id: 'settings', label: t('devices.this.settings'), icon: <Icon name="settings" size={14} />, onSelect: remoteSettings }
  ]
  const deviceMenu = (runtimeId: string): Array<MenuItem | 'separator'> => {
    const r = paired?.find((x) => x.runtimeId === runtimeId)
    if (!r) return []
    const item: Record<ReturnType<typeof deviceActions>[number], MenuItem> = {
      open: { id: 'open', label: t('devices.menu.open'), icon: <Icon name="screen" size={14} />, onSelect: () => openDevice(runtimeId) },
      check: { id: 'check', label: t('devices.menu.check'), icon: <Icon name="refresh" size={14} />, onSelect: () => void check(runtimeId) },
      retry: { id: 'retry', label: t('devices.menu.retry'), icon: <Icon name="refresh" size={14} />, onSelect: () => void check(runtimeId) },
      forget: { id: 'forget', label: t('devices.menu.forget'), icon: <Icon name="delete" size={14} />, danger: true, onSelect: () => void forget(runtimeId, r.name) }
    }
    return deviceActions(deviceState(r)).map((a) => item[a])
  }
  const foundMenu = (key: string): Array<MenuItem | 'separator'> => {
    const f = toFind.find((x) => x.key === key)
    if (!f) return []
    const item = {
      add: { id: 'add', label: t('devices.menu.add'), icon: <Icon name="add" size={14} />, onSelect: () => openAddDevice(f) },
      copyAddress: {
        id: 'copyAddress',
        label: t('devices.menu.copyAddress'),
        icon: <Icon name="copy" size={14} />,
        onSelect: () => {
          window.api.clipboard.writeText(f.address)
          toast.success(t('devices.menu.copied', { address: f.address }))
        }
      }
    } satisfies Record<(typeof FOUND_ACTIONS)[number], MenuItem>
    return FOUND_ACTIONS.map((a) => item[a])
  }

  const title = t('shell.activity.devices')
  return (
    <ViewContainer label={title}>
      <ViewToolbar
        label={title}
        items={[
          { id: 'add', icon: <Icon name="add" />, label: t('devices.add.title'), onClick: () => openAddDevice() },
          { id: 'refresh', icon: <Icon name="refresh" />, label: t('devices.refresh'), onClick: () => refreshDevices() }
        ]}
      />
      <ViewPane title={t('devices.pane.this')} storageKey="devices.this" className="devices-this">
        <div className="devices-tree" {...thisClick.handlers}>
          <Tree label={t('devices.pane.this')} rows={thisRows} onSelect={thisClick.onSelect} onOpen={remoteSettings} onContextMenu={(_id, e) => open(e, thisMenu())} />
        </div>
      </ViewPane>
      <ViewPane title={t('devices.pane.yours')} count={paired && paired.length > 0 ? paired.length : undefined} storageKey="devices.yours">
        {paired === null ? (
          <p className="wb-view-empty">{t('devices.loading')}</p>
        ) : paired.length === 0 ? (
          <div className="devices-empty">
            <p>{t('devices.empty.yours')}</p>
            <Button variant="primary" size="sm" onClick={() => openAddDevice()}>
              {t('devices.add.title')}
            </Button>
          </div>
        ) : (
          <div className="devices-tree" {...yours.handlers}>
            <Tree label={t('devices.pane.yours')} rows={pairedRows} onSelect={yours.onSelect} onOpen={openDevice} selectedId={activeDevice(p.activeTabId)} onContextMenu={(id, e) => open(e, deviceMenu(id))} />
          </div>
        )}
      </ViewPane>
      <ViewPane title={t('devices.pane.found')} count={toFind.length > 0 ? toFind.length : undefined} storageKey="devices.found">
        {toFind.length === 0 ? (
          <div className="devices-empty">
            <p>{t('devices.empty.found')}</p>
            <Button variant="secondary" size="sm" onClick={() => openAddDevice()}>
              {t('devices.add.byAddress')}
            </Button>
          </div>
        ) : (
          <Tree label={t('devices.pane.found')} rows={foundRows} onOpen={addFound} onContextMenu={(id, e) => open(e, foundMenu(id))} />
        )}
      </ViewPane>
      {menu && menu.items.length > 0 && <Menu at={menu.at} items={menu.items} label={t('devices.menu.label')} onClose={() => setMenu(null)} />}
      {adding && (
        <AddDeviceModal
          found={toFind}
          initial={adding.found}
          homeDir={p.homeDir}
          onClose={closeAddDevice}
          onPaired={() => {
            refreshDevices()
            p.setPairedChanged((n) => n + 1)
          }}
          onNewConsole={p.setRemoteDialog}
          onRunInTerminal={(command) => void p.newTerminal(command)}
        />
      )}
    </ViewContainer>
  )
}

/** The device whose tab is active, selected in Your devices. */
function activeDevice(activeTabId: string | null): string | null {
  const v = activeTabId ? parseViewTab(activeTabId) : null
  return v?.name === 'device' ? (v.arg ?? null) : null
}

/** A click opens the tab; the arrow keys only move the selection (Enter opens), as in VSCode's lists. */
function useClickOpen(open: (id: string) => void): { handlers: React.HTMLAttributes<HTMLDivElement>; onSelect: (id: string) => void } {
  const viaKey = useRef(false)
  return {
    handlers: { onKeyDownCapture: () => void (viaKey.current = true), onPointerDownCapture: () => void (viaKey.current = false) },
    onSelect: (id) => {
      if (!viaKey.current) open(id)
    }
  }
}
