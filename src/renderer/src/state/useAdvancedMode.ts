// T19: the one "Advanced mode" switch (off by default). Simple mode shows the essentials; advanced rows and the technical
// parts of a plan appear with the switch. A renderer-only pref kept like the app's other `cm.` prefs, in one store so every
// component that reads it changes together.
import { useSyncExternalStore } from 'react'

export const ADVANCED_MODE_KEY = 'cm.advancedMode'

const listeners = new Set<() => void>()
let value: boolean | null = null

function stored(): boolean {
  try {
    return globalThis.localStorage?.getItem(ADVANCED_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export const getAdvancedMode = (): boolean => (value ??= stored())

export function setAdvancedMode(on: boolean): void {
  value = on
  try {
    globalThis.localStorage?.setItem(ADVANCED_MODE_KEY, on ? '1' : '0')
  } catch {
    /* no storage: the switch lasts until the window closes */
  }
  listeners.forEach((l) => l())
}

/** Test seam: forget the cached value so the next read goes to storage again. */
export const resetAdvancedMode = (): void => {
  value = null
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** `[advanced, setAdvanced]`: whether Advanced mode is on, and the setter. */
export function useAdvancedMode(): readonly [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, getAdvancedMode), setAdvancedMode]
}
