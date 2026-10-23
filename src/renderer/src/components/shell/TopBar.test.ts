// TopBar.tsx is no longer mounted (DESIGN-W13: the activity bar and the Manage menu replaced the tabs and the More
// menu). Its More rows still lead somewhere: each old page lands on a side bar view through the openPage shim.
import { describe, expect, it, vi } from 'vitest'
import { t as translate } from '../../../../core/i18n'
import { MORE_MENU_PAGES } from '../../../../core/ui/pages'
import { pageTargetOf, registerNavigation, type NavigationHandlers } from './navigation'
import { manageItems } from './ActivityBar'

const t = ((k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate('en', k, p)) as never

describe('the old More menu pages in the workbench', () => {
  it('every More page has a side bar view', () => {
    for (const id of MORE_MENU_PAGES) expect(pageTargetOf(id)).toHaveProperty('activity')
  })
})

describe('Manage menu', () => {
  it('lists Settings, Keyboard shortcuts, Help and Check for updates, each with an icon', () => {
    const items = manageItems(t)
    expect(items.map((it) => it.id)).toEqual(['settings', 'keys', 'help', 'update'])
    for (const it of items) expect(it.icon).toBeTruthy()
  })

  it('Settings opens the Settings tab; Keyboard shortcuts opens Settings on the shortcuts row', () => {
    const handlers = { openView: vi.fn(), openSettings: vi.fn() } as unknown as NavigationHandlers
    const off = registerNavigation(handlers)
    manageItems(t)[0]!.onSelect()
    manageItems(t)[1]!.onSelect()
    expect(handlers.openView).toHaveBeenCalledWith('settings')
    expect(handlers.openSettings).toHaveBeenCalledWith('shortcuts', undefined)
    off()
  })
})
