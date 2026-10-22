import { Menu, type MenuItem as UiMenuItem } from './ui/Menu'

// The right-click menu is ui/Menu's context mode now. This path and its `{ x, y, items, onClose }` shape stay so the
// importers keep compiling until Wave 3 moves them to `<Menu at={menuPointOf(e)} … />` from './ui'.
export type MenuItem = UiMenuItem | 'separator'

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }): React.JSX.Element {
  return <Menu at={{ x, y }} items={items} onClose={onClose} />
}
