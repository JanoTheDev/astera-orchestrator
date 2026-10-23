// The owner's own instructions for Astera's agents (Settings > Agents). One Markdown file per role in
// `<profile>/prompts/<role>.md`, appended to the END of the built prompt, brief or spec under a heading.
// Append-only: the built-in text carries the CLI contract (how to report, commit, ask), so nothing here
// can replace or reorder it. A missing or empty file adds nothing, and the prompt stays byte-identical.

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { renameRetrying } from '../renameRetry'
import type { PromptInfo, PromptRole, PromptSetResult } from '../types'

export const PROMPT_ROLES: readonly PromptRole[] = ['session', 'planner', 'coordinator', 'worker', 'reviewer']
/** The most one role may hold. Enforced on save: a longer text is rejected, never cut. */
export const MAX_OWNER_BYTES = 8 * 1024
export const OWNER_HEADING = 'INSTRUCTIONS FROM THE OWNER (Settings > Agents)'

export const isPromptRole = (v: unknown): v is PromptRole => PROMPT_ROLES.includes(v as PromptRole)

export const ownerFile = (profileDir: string, role: PromptRole): string => path.join(profileDir, 'prompts', `${role}.md`)

/** The profile folder of a specs folder (`<profile>/orch/specs`, the one place the spec builders' callers know). */
export const profileDirOfSpecs = (specsDir: string): string => path.dirname(path.dirname(specsDir))

/** `prompt` with the owner's text as a headed block at its end; `prompt` itself when there is no text or it
 *  already carries the block (a spec rebuilt by a repair or recovery is handed to the same start as one built there). */
export function appendTo(prompt: string, text: string | undefined | null): string {
  const t = text?.trim()
  return t && !prompt.includes(`\n## ${OWNER_HEADING}\n`) ? `${prompt.replace(/\n+$/, '')}\n\n---\n## ${OWNER_HEADING}\n\n${t}\n` : prompt
}

/** The saved text of a role; '' when there is none or it cannot be read (an unreadable file adds nothing). */
export async function read(profileDir: string | undefined, role: PromptRole): Promise<string> {
  if (!profileDir) return ''
  try {
    return await fs.readFile(ownerFile(profileDir, role), 'utf8')
  } catch {
    return ''
  }
}

/** Saves a role's text. Blank text removes the file. Rejects an unknown role and text over MAX_OWNER_BYTES. */
export async function write(profileDir: string, role: unknown, text: unknown): Promise<PromptSetResult> {
  if (!isPromptRole(role)) return { ok: false, error: 'invalid-role' }
  if (typeof text !== 'string') return { ok: false, error: 'invalid-text' }
  if (Buffer.byteLength(text, 'utf8') > MAX_OWNER_BYTES) return { ok: false, error: 'too-long', max: MAX_OWNER_BYTES }
  if (!text.trim()) return reset(profileDir, role)
  const file = ownerFile(profileDir, role)
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' })
    await renameRetrying(tmp, file)
    return { ok: true }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    return { ok: false, error: 'write-failed', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function reset(profileDir: string, role: unknown): Promise<PromptSetResult> {
  if (!isPromptRole(role)) return { ok: false, error: 'invalid-role' }
  try {
    await fs.rm(ownerFile(profileDir, role), { force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'write-failed', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function list(profileDir: string): Promise<PromptInfo[]> {
  return Promise.all(
    PROMPT_ROLES.map(async (role) => {
      const bytes = Buffer.byteLength((await read(profileDir, role)).trim(), 'utf8')
      return { role, bytes, set: bytes > 0 }
    })
  )
}
