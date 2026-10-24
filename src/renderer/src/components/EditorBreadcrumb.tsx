import { Fragment } from 'react'
import { foldPathCase } from '../../../core/files/paths'
import { resolveFileIcon } from '../../../core/files/icons'
import { useI18n } from '../i18n/I18nProvider'
import { FileIcon } from './FileIcon'
import { Icon } from './ui'

/** The path segments of `path`, relative to `root` when it lies inside it (the whole path otherwise). */
export function crumbsOf(path: string, root?: string): string[] {
  const parts = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean)
  const all = parts(path)
  if (!root) return all
  const base = parts(root)
  const inside = base.length < all.length && base.every((seg, i) => foldPathCase(seg) === foldPathCase(all[i]))
  return inside ? all.slice(base.length) : all
}

/** The header line above an open file (VSCode's breadcrumbs): folders dim, the file name bright with its icon. */
export function EditorBreadcrumb({ path, root }: { path: string; root?: string }): React.JSX.Element {
  const { t } = useI18n()
  const segs = crumbsOf(path, root)
  const name = segs[segs.length - 1] ?? path
  return (
    <nav className="editor-crumbs" aria-label={t('files.editor.breadcrumb')} title={path}>
      {segs.slice(0, -1).map((seg, i) => (
        <Fragment key={i}>
          <span className="editor-crumb">{seg}</span>
          <Icon name="chevronRight" size={14} className="editor-crumb-sep" />
        </Fragment>
      ))}
      <span className="editor-crumb editor-crumb-file" aria-current="page">
        <FileIcon {...resolveFileIcon(name)} />
        {name}
      </span>
    </nav>
  )
}
