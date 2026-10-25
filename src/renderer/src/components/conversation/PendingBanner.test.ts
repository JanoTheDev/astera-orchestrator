// The exited banner's Restart button: shown only when the pane passes a restart, and it calls that restart.
import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  // ExitedNotice keeps one piece of state (the stderr fold). The test calls it outside a render, so state is a constant.
  useState: <T,>(v: T) => [v, () => {}] as const
}))
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

import { ExitedNotice } from './PendingBanner'

/** Every element whose children are exactly `label` — the Button the banner renders with that text. */
function buttonsLabelled(node: ReactNode, label: string): ReactElement<{ onClick?: () => void; children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap((n) => buttonsLabelled(n, label))
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return []
  const kids = node.props.children
  return [...(kids === label ? [node] : []), ...buttonsLabelled(kids, label)]
}

const restartLabel = 'conversation.exited.restart'

describe('ExitedNotice restart button', () => {
  it('shows Restart and calls the restart when the pane passes one', () => {
    const onRestart = vi.fn()
    const buttons = buttonsLabelled(ExitedNotice({ exitCode: 1, onRestart }), restartLabel)

    expect(buttons).toHaveLength(1)
    buttons[0].props.onClick?.()
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('shows no Restart button when no restart is passed', () => {
    expect(buttonsLabelled(ExitedNotice({ exitCode: 1 }), restartLabel)).toHaveLength(0)
  })
})
