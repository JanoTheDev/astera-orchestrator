import path from 'node:path'
import { mediaKindOf } from '../../core/files/media'

/**
 * An image or a video the explorer or a Markdown preview opens, admitted to the media allowlist so the viewer tab may
 * load it (allowlist.ts), or null.
 *
 * Through the project guard (`assertAllowedPath`, the one files.list and files.read use), not files.resolveLink: that
 * one refuses UNC and device paths before any stat (it runs on a terminal's hover), so a project on a share or in
 * `\\wsl$` could not open its own images, and it admits any absolute path the renderer names, so a preview's
 * `../../..` link could put a file outside every project on screen (final review of the explorer opening media,
 * minors 2 and 3). Here only a regular media file inside a project the person opened is admitted.
 */
export async function admitProjectMedia(
  p: string,
  d: {
    assertAllowedPath: (p: string) => Promise<unknown>
    stat: (p: string) => Promise<{ isFile(): boolean }>
    allowlist: { add(p: string): boolean }
  }
): Promise<{ path: string } | null> {
  if (typeof p !== 'string' || !path.isAbsolute(p) || mediaKindOf(p) === null) return null
  const abs = path.normalize(p)
  try {
    await d.assertAllowedPath(abs)
    if (!(await d.stat(abs)).isFile()) return null
  } catch {
    return null
  }
  return d.allowlist.add(abs) ? { path: abs } : null
}
