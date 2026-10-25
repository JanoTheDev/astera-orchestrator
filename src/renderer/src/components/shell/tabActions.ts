// The effects behind the tab menu and the Agents rows (the choices are in tabMenu.ts).
import type { Account, SessionInfo } from '../../../../core/types'
import { providerOf } from '../../../../core/providers/meta'
import { confirmModal } from '../../lib/confirm'
import { toast } from '../../lib/toast'
import type { Translate } from '../checkText'

export const copyText = (text: string): void => void navigator.clipboard.writeText(text).catch(() => undefined)

export function revealPath(path: string, t: Translate): void {
  window.api.files.reveal(path).catch((err: unknown) => toast.error(t('explorer.reveal.failed', { detail: err instanceof Error ? err.message : String(err) })))
}

/** Stops the process and keeps the tab: no closeSession, so the exit arrives as an event and the scrollback stays. */
export async function stopKeepTab(s: SessionInfo, name: string, t: Translate): Promise<void> {
  if (!(await confirmModal({ title: t('overlays.tabMenu.stopTitle', { name }), body: t('overlays.tabMenu.stopBody'), confirmLabel: t('overlays.tabMenu.stop'), danger: true }))) return
  await window.api.sessions.kill(s.id)
}

/** The accounts a running session can move to: its own provider, not the one it is on. */
export const moveTargets = (s: SessionInfo, accounts: Account[]): Account[] => {
  const from = accounts.find((a) => a.id === s.accountId)
  return accounts.filter((a) => a.id !== s.accountId && providerOf(a) === providerOf(from ?? {}))
}

export async function moveToAccount(s: SessionInfo, a: Account, t: Translate): Promise<void> {
  try {
    const r = await window.api.rolling.switchTo(s.id, a.id)
    if (r.outcome === 'switched' || r.outcome === 'same') toast.success(t('account.switch.done', { label: a.label }))
    else if (r.outcome === 'busy') toast.info(t('account.switch.busy'))
    else toast.error(t('account.switch.failed', { detail: r.reason ?? '' }))
  } catch (err) {
    toast.error(t('account.switch.failed', { detail: err instanceof Error ? err.message : String(err) }))
  }
}
