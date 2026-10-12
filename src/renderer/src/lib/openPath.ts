// How the explorer and a Markdown preview open a file, as a terminal link does (App's openLinkedPath): an image or a
// video goes to the media viewer, any other file to a file tab. The viewer loads only a file main resolved (which
// admits it to the media allowlist, main/media/allowlist.ts), so a media file is resolved first; one main does not
// resolve, or a resolve that fails, opens in a file tab as before.
import { mediaKindOf } from '../../../core/files/media'

export async function openPath(
  path: string,
  d: { resolve: (path: string) => Promise<string | null>; openMedia: (path: string) => void; openFile: (path: string) => void }
): Promise<void> {
  if (mediaKindOf(path)) {
    const resolved = await d.resolve(path).catch(() => null)
    if (resolved) return d.openMedia(resolved)
  }
  d.openFile(path)
}
