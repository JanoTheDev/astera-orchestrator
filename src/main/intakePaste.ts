// T4: a file pasted into Start with no path of its own (a clipboard image) is written here, and Start attaches the path
// through the ordinary intake (intake.addPaths → copyIntakeFiles). A new plan has no session yet, so the conversation
// attach folder (keyed by session id) cannot hold it.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { attachmentNameOf } from '../core/files/attachmentName'

/** The most this will write for one dropped or pasted file. A prompt attachment is a screenshot or a
 *  document, not a disk image, and the cap is what keeps a stray drop from filling a disk. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

let nonce = 0

/** Writes the pasted bytes to `<userData>/intake-paste/<uuid>/<name>` and answers that absolute path. Every argument
 *  comes from the renderer: the name is reduced to a safe base name (stamped, so two "image.png" pastes stay two
 *  attachments: the intake refuses duplicate names), the mime must look like one, and the size is capped. */
export async function saveClipboardFile(userData: string, name: unknown, mime: unknown, base64: unknown): Promise<string> {
  if (typeof name !== 'string' || typeof mime !== 'string' || typeof base64 !== 'string') throw new Error('INVALID_ATTACHMENT')
  if (mime !== '' && !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error('INVALID_MIME')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('EMPTY_ATTACHMENT')
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_TOO_LARGE')
  const dir = path.join(userData, 'intake-paste', randomUUID())
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  // basename first: attachmentNameOf would keep a folder's name glued to the file's
  const file = path.join(dir, attachmentNameOf(path.basename(name.replaceAll('\\', '/')), mime, new Date(), ++nonce))
  await fs.writeFile(file, bytes, { mode: 0o600 })
  return file
}
