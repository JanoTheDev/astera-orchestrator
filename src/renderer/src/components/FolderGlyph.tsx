import { Icon, type IconSize } from './ui'

/** Folder glyph for lists outside the file tree: the ui icon registry's folder (FileIcon's folder set stays the tree's own). */
export function FolderGlyph({ size = 14 }: { size?: IconSize }): React.JSX.Element {
  return <Icon name="folder" size={size} />
}
