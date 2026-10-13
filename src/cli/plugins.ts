// `astera plugins install` (plugin runtime design P6): what the Host is asked, in what order. The folder is inspected
// first; without `--yes` or `--grant` nothing is installed and the person is shown what the plugin is and asks for.
// The install then carries what was shown (`expect`), so the Host refuses a folder that changed in between.
import path from 'node:path'
import { PLUGIN_TRUST_WARNING } from '../core/plugins/manifest'

/** What one Host call came back as: an answer, or none (`callHost`). */
export type PluginCall = { status: number; body: unknown } | { unreachable: string } | { stuck: string }

/** The sentence a person reads before approving (spec §31). */
export function approvalMessage(inspection: Record<string, unknown>): string {
  const permissions = Array.isArray(inspection.permissions) ? (inspection.permissions as string[]) : []
  const asks = permissions.length > 0 ? permissions.join(', ') : 'no permissions'
  const wontRun = inspection.compatible === false && typeof inspection.reason === 'string' ? ` It will not run here: ${inspection.reason}.` : ''
  return (
    `${String(inspection.displayName)} ${String(inspection.version)} (${String(inspection.id)}) asks for: ${asks}. ` +
    `${PLUGIN_TRUST_WARNING}${wontRun} Approve with --yes, or name what to grant with --grant <list>.`
  )
}

/** `--grant a,b`: the names, trimmed, with empty ones dropped. */
const grantOf = (v: unknown): string[] | null =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    : null

export async function installPlugin<R extends PluginCall>(a: {
  args: Record<string, unknown>
  /** The shell's folder: a relative --path means one there, not one beside the Host. */
  cwd: string
  /** The request id this invocation carries; it goes on the install, the call that acts. */
  request: string | undefined
  call: (cmd: string, args: Record<string, unknown>, request: string | undefined) => Promise<R>
}): Promise<R | { status: number; body: unknown } | { approve: Record<string, unknown> }> {
  const given = a.args.path
  if (typeof given !== 'string' || given === '') return { status: 400, body: { error: 'plugins install needs --path <folder>' } }
  const folder = path.resolve(a.cwd, given)
  const shown = await a.call('plugins-inspect', { path: folder }, undefined)
  if (!('status' in shown) || shown.status !== 200) return shown
  const inspection = shown.body as Record<string, unknown>
  const named = grantOf(a.args.grant)
  if (named === null && a.args.yes !== true) return { approve: inspection }
  const grant = named ?? (Array.isArray(inspection.permissions) ? (inspection.permissions as string[]) : [])
  return a.call(
    'plugins-install',
    { path: folder, grant, expect: { name: inspection.name, version: inspection.version } },
    a.request
  )
}
