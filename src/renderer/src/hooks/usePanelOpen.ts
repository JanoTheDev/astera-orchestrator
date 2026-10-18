import { useState } from 'react'

/** W7-F (#83): a sidebar section's open/closed chevron, remembered per section in this window's storage. Storage can
 *  be missing or refuse (a private profile): the section then just opens. */
export function usePanelOpen(key: string, initial = true): [boolean, (update: (open: boolean) => boolean) => void] {
  const storageKey = `astera.panelOpen.${key}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const set = (update: (open: boolean) => boolean): void =>
    setOpen((cur) => {
      const next = update(cur)
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        /* not remembered, still toggled */
      }
      return next
    })
  return [open, set]
}
