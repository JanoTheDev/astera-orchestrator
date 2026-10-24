// The Devices side bar view (DESIGN-W13 §4): This computer (whether it takes work from other devices), Your devices
// (the paired Runtimes, online or not; a click opens the device's `view:device` tab) and Found on your network (the
// found devices not paired yet, each with an inline Add). The Add device modal opens from here.
import { useEffect, useRef } from 'react'
import { parseViewTab } from '../../../../core/panes/tabId'
import { Button, Icon, IconButton, Tree, ViewContainer, ViewPane, type TreeItem } from '../ui'
import { openSettings, openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { AddDeviceModal } from '../devices/AddDeviceModal'
import { deviceState, foundNotPaired, needsAttention, osName, sourceLabel } from '../devices/devicesView'
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

  const accepts = !!mine && mine.gateway.state !== 'disabled'
  const thisRows: TreeItem[] = [
    {
      id: THIS,
      depth: 0,
      label: t('devices.thisComputer'),
      title: mine ? `${t('devices.thisComputer')}\n${t(accepts ? 'devices.this.accepts' : 'devices.this.off')}` : undefined,
      icon: <Icon name="laptop" size={16} />,
      description: mine === undefined ? '' : mine === null ? t('devices.this.unknown') : t(accepts ? 'devices.this.acceptsShort' : 'devices.this.offShort'),
      actions: <IconButton size="sm" icon={<Icon name="settings" size={14} />} label={t('devices.this.settings')} onClick={remoteSettings} />
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
          <Tree label={t('devices.pane.this')} rows={thisRows} onSelect={thisClick.onSelect} onOpen={remoteSettings} />
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
            <Tree label={t('devices.pane.yours')} rows={pairedRows} onSelect={yours.onSelect} onOpen={openDevice} selectedId={activeDevice(p.activeTabId)} />
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
          <Tree label={t('devices.pane.found')} rows={foundRows} onOpen={addFound} />
        )}
      </ViewPane>
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
