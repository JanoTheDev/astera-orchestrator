// One store of the devices for the Devices view, its device tabs and the activity badge: the paired Runtimes with their
// accounts, the Runtimes Bring my setup can reach, this computer as a Runtime, and the devices found on the network.
// Read once on the first use and again on Refresh or after a change; the found list follows `onFound` once the view
// has started discovery (the first `discover()` starts listening, so the badge alone never does).
import { useEffect, useSyncExternalStore } from 'react'
import type { FoundDevice, RemoteApi, RemoteRuntimeInfo } from '../../../../core/types'
import { remoteCall } from '../../lib/remoteSessions'
import { createRefreshGate } from './refreshGate'
import type { AccountsOf, DeviceAccount } from './devicesView'

export type ThisMachine = Awaited<ReturnType<RemoteApi['thisMachine']>>

export interface DevicesSnapshot {
  /** null until the first list arrives. */
  paired: RemoteRuntimeInfo[] | null
  accountsOf: AccountsOf
  /** The devices added over SSH, where Copy my setup again can reach. */
  migratable: string[]
  /** undefined until asked; null when the Host cannot say. */
  mine: ThisMachine | undefined
  found: FoundDevice[]
  /** The Add device modal: open with a found device to prefill, or with nothing. */
  adding: { found?: FoundDevice } | null
}

let snap: DevicesSnapshot = { paired: null, accountsOf: {}, migratable: [], mine: undefined, found: [], adding: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<DevicesSnapshot>): void => {
  snap = { ...snap, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const gate = createRefreshGate()
/** Reads the paired list, each device's accounts and this computer again. Asking for accounts is what tells whether a
 *  device answers, so the list is read once more after those answers to pick up its online state. The accounts of the
 *  devices are asked in parallel. `force` is false for the refresh a view makes on show: that one is skipped while a
 *  refresh is in flight or just finished (the store already holds what it read). */
export function refreshDevices(force = true): void {
  if (!gate.begin(force)) return
  const list = window.api.remote.list().then(
    async (paired) => {
      set({ paired })
      const asks = paired.map((r) =>
        remoteCall(r.runtimeId, 'accounts-list', {}).then(
          (a) => set({ accountsOf: { ...snap.accountsOf, [r.runtimeId]: a.status === 200 && Array.isArray(a.body) ? (a.body as DeviceAccount[]) : null } }),
          () => set({ accountsOf: { ...snap.accountsOf, [r.runtimeId]: null } })
        )
      )
      if (asks.length > 0) {
        await Promise.allSettled(asks)
        await window.api.remote.list().then((l) => set({ paired: l }), () => undefined)
      }
    },
    () => set({ paired: [] })
  )
  const migration = window.api.remote.migrationMachines().then((m) => set({ migratable: m }), () => set({ migratable: [] }))
  const mine = window.api.remote.thisMachine().then((m) => set({ mine: m }), () => set({ mine: null }))
  void Promise.allSettled([list, migration, mine]).then(() => gate.end())
}

let discovering = false
/** Starts listening for devices on the network (once per window). */
export function startDiscovery(): void {
  if (discovering) return
  discovering = true
  void window.api.remote.discover().then((found) => set({ found }), () => undefined)
  window.api.remote.onFound((found) => set({ found }))
}

/** The store as it is now, outside React (a device tab's title). */
export const devicesSnapshot = (): DevicesSnapshot => snap

export const openAddDevice = (found?: FoundDevice): void => set({ adding: found ? { found } : {} })
export const closeAddDevice = (): void => set({ adding: null })

export function useDevices(): DevicesSnapshot {
  const s = useSyncExternalStore(subscribe, () => snap)
  useEffect(() => {
    refreshDevices(false)
  }, [])
  return s
}
