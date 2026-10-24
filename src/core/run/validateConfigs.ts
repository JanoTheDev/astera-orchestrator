// The checks a run configuration list must pass before it is stored. One copy, used by the app's
// Apply (main/run/saveConfigs.ts) and by `run-configs add` (the Host), so a configuration an agent
// saves is held to what the dialog holds a person to.
import type { RunConfig, SaveReason } from './types'
import { migrateRunConfigs } from './migrate'
import { hasUnsafeWin32Chars } from './build'
import { isSeedId } from './draft'
import { isHttpUrl } from '../preview/url'

// cmd.exe interprets & | ^ % ! < > even inside double quotes — assembly cannot guard against that, so
// it is rejected at save time. **Only values that land in the command string are checked.** id/name
// are metadata, cwd is handed to the PTY as its working directory rather than interpolated, folder and
// temporary are tree metadata and never reach a command string, javaHome/springProfiles become
// environment variables, and beforeLaunch/members hold configuration ids the launch planner reads — no
// id is ever interpolated into a command. previewUrl is an address the renderer opens, never
// interpolated — and a query string legitimately holds `&`. Why an exclude list: the failure direction
// is the safe one — a new field defaults to being checked.
const NOT_IN_COMMAND = new Set([
  'id', 'name', 'cwd', 'env', 'folder', 'javaHome', 'springProfiles', 'beforeLaunch', 'members', 'temporary', 'previewUrl'
])

export interface ConfigError {
  id: string
  reason: SaveReason
}

/** What each refusal means, for a caller that has no dialog to show it in. */
export const SAVE_REASON_TEXT: Record<SaveReason, string> = {
  INVALID_CONFIG: 'not a valid configuration (missing or wrong field, unknown type, empty or seed id, or a duplicate id)',
  INVALID_CWD: 'cwd is not inside the project',
  INVALID_PREVIEW_URL: 'previewUrl is not an http(s) URL',
  UNSAFE_VALUE: 'a value holds a character cmd.exe would interpret (& | ^ % ! < >)'
}

/** Every item of `configs` that may not be stored, each named once with its reason; empty when the
 *  list is fine. Seeds are detected from the project's files, never stored; a duplicate id would make
 *  the tree and the store disagree about which row a click means. Both are INVALID_CONFIG, like a
 *  shape migrateRunConfigs will not accept — an incomplete configuration is accepted (allowIncomplete),
 *  as ＋ creates one with its required field still empty; run.start is what refuses to run it.
 *  `assertConfigCwd` throws for a cwd that is not allowed. */
export async function validateConfigs(a: {
  projectPath: string
  configs: RunConfig[]
  platform: NodeJS.Platform
  assertConfigCwd: (projectPath: string, cwd: unknown) => Promise<void>
}): Promise<ConfigError[]> {
  const errors: ConfigError[] = []
  const count = new Map<string, number>()
  for (const c of a.configs) {
    const id = typeof c?.id === 'string' ? c.id : ''
    count.set(id, (count.get(id) ?? 0) + 1)
  }
  for (const c of a.configs) {
    const id = typeof c?.id === 'string' ? c.id : ''
    if (id === '' || isSeedId(id) || (count.get(id) ?? 0) > 1 || migrateRunConfigs([c], { allowIncomplete: true }).length === 0) {
      errors.push({ id, reason: 'INVALID_CONFIG' })
      continue
    }
    try {
      await a.assertConfigCwd(a.projectPath, c.cwd)
    } catch {
      errors.push({ id, reason: 'INVALID_CWD' })
      continue
    }
    // An address the preview opens on start. Checked here rather than in the form so a hand-edited
    // store cannot hold a value the renderer would then try to load.
    if (c.previewUrl !== undefined && !isHttpUrl(c.previewUrl)) {
      errors.push({ id, reason: 'INVALID_PREVIEW_URL' })
      continue
    }
    if (a.platform === 'win32' && c.type !== 'shell') {
      for (const [k, v] of Object.entries(c as unknown as Record<string, unknown>)) {
        if (NOT_IN_COMMAND.has(k)) continue
        if (typeof v === 'string' && hasUnsafeWin32Chars(v)) {
          errors.push({ id, reason: 'UNSAFE_VALUE' })
          break
        }
      }
    }
  }
  return errors
}
