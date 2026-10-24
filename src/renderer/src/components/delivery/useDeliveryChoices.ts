// T6: the Delivery choice as the project is really set up: only the deliveries that work (core deliveryChoices.ts), in
// plain words, and the one a saved setting that does not work now falls back to, with the reason in one line. Shared by
// Project settings > Delivery, Plan settings and the New plan page.
import { useEffect, useMemo, useState } from 'react'
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import { deliveryChoicesOf, effectiveDelivery, type DeliverySetup } from '../../../../core/orchestration/deliveryChoices'
import type { DeliveryMode } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'

type T = (key: MessageKey, params?: MessageParams) => string

export interface DeliveryOptions {
  /** The Select's items: the deliveries that work, in order (merge, push, pull request, review). */
  options: { value: DeliveryMode; label: string }[]
  /** What the Select shows: the saved delivery, or its fallback when it does not work now. */
  mode: DeliveryMode
  /** Why the saved delivery is not offered (one short line), or null. */
  reason: string | null
}

/** The options for `saved` over what the folder is set up for. `setup` null (not read yet, or a plan on another
 *  machine, whose folder this computer cannot read): every delivery is offered and the saved one kept. */
export function deliveryOptionsOf(setup: DeliverySetup | null, saved: DeliveryMode, deliveryBranch: string | undefined, t: T): DeliveryOptions {
  const branch = deliveryBranch ?? setup?.branch ?? t('delivery.defaultBranch')
  const choices = setup === null ? null : deliveryChoicesOf(setup)
  const shown = choices?.filter((c) => c.available) ?? (['merge', 'push', 'pr', 'manual'] as const).map((mode) => ({ mode, host: undefined, github: undefined }))
  const label = (c: (typeof shown)[number]): string => {
    if (c.mode === 'merge') return t('delivery.merge', { branch })
    if (c.mode === 'push') return c.github === true ? t('delivery.push', { branch }) : t('delivery.pushTo', { branch, remote: c.host ?? 'origin' })
    return t(c.mode === 'pr' ? 'delivery.pr' : 'delivery.manual')
  }
  const eff = choices === null ? { mode: saved } : effectiveDelivery(saved, choices)
  return {
    options: shown.map((c) => ({ value: c.mode, label: label(c) })),
    mode: eff.mode,
    reason: eff.reason === undefined ? null : t(`delivery.off.${eff.reason}`)
  }
}

/** The project folder's setup, read once per folder (`projects.deliverySetup`); null while it loads, for no folder, or
 *  when it cannot be read. */
export function useDeliverySetup(projectPath: string | undefined): DeliverySetup | null {
  const [setup, setSetup] = useState<{ path: string; setup: DeliverySetup } | null>(null)
  useEffect(() => {
    if (projectPath === undefined) return
    let live = true
    window.api.projects
      .deliverySetup(projectPath)
      .then((s) => live && setSetup({ path: projectPath, setup: s }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [projectPath])
  return setup !== null && setup.path === projectPath ? setup.setup : null
}

/** The Delivery choice of a project on this computer (`projectPath`; undefined for a plan on another machine). */
export function useDeliveryChoices(projectPath: string | undefined, saved: DeliveryMode, deliveryBranch?: string): DeliveryOptions {
  const { t } = useI18n()
  const setup = useDeliverySetup(projectPath)
  return useMemo(() => deliveryOptionsOf(setup, saved, deliveryBranch, t), [setup, saved, deliveryBranch, t])
}
