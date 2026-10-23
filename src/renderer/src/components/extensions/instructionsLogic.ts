// Settings › Agents › Custom instructions, the pure parts: the byte count against the cap, and what a save answer means.
import type { PromptRole, PromptSetResult } from '../../../../core/types'

/** The same roles and cap as core/prompts/ownerInstructions.ts (a node file the renderer cannot import); the save
 *  re-checks the cap and answers `too-long` with the real one. */
export const PROMPT_ROLES: readonly PromptRole[] = ['session', 'planner', 'coordinator', 'worker', 'reviewer']
export const MAX_INSTRUCTION_BYTES = 8 * 1024

/** UTF-8 bytes, what the cap counts: a Korean or Japanese character is three. */
export const byteLength = (text: string): number => new TextEncoder().encode(text).length

export const overCap = (text: string, max = MAX_INSTRUCTION_BYTES): boolean => byteLength(text) > max

/** The editor's state against what is saved: Save is live while the text differs and fits. */
export function editorState(draft: string, saved: string, max = MAX_INSTRUCTION_BYTES): { dirty: boolean; tooLong: boolean; canSave: boolean } {
  const dirty = draft !== saved
  const tooLong = overCap(draft, max)
  return { dirty, tooLong, canSave: dirty && !tooLong }
}

/** A failed save as a message key and its params; null when it worked. */
export function saveFailure(r: PromptSetResult): { key: 'tooLong' | 'invalid' | 'writeFailed'; max?: number; detail?: string } | null {
  if (r.ok) return null
  if (r.error === 'too-long') return { key: 'tooLong', max: r.max }
  if (r.error === 'write-failed') return { key: 'writeFailed', detail: r.message }
  return { key: 'invalid' }
}
