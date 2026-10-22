import { Icon, type IconSize } from './ui'

/** Branch glyph for the worktree base-branch picker: the ui registry's branch icon, so it matches every other branch mark.
 *  Kept as a component because the picker (NewSessionDialog) imports it by this name and size. */
export function BranchGlyph({ size = 14 }: { size?: IconSize }): React.JSX.Element {
  return <Icon name="branch" size={size} />
}
