// T32: what a project folder is set up for, read on this computer: the one reader behind main's `projects.deliverySetup`
// (the Delivery choice) and the Host's delivery (`deliveryLandingOf`, delivery.ts), so both agree on what works.
//
// Node-side: runs git and `gh auth status`. The pure side is ../deliveryChoices.ts.
import path from 'node:path'
import { probeGh } from '../../github/gh'
import { hasOriginRemote } from '../../projects/create'
import { git, gitDir } from '../../worktrees/git'
import type { DeliverySetup } from '../deliveryChoices'

/** The folder's git facts; `ghSignedIn` is the caller's (gh is one answer for the whole machine). */
export async function readFolderSetup(p: string, ghSignedIn: boolean): Promise<DeliverySetup> {
  const isGitRepo = typeof p === 'string' && path.isAbsolute(p) && (await gitDir(p)) !== null
  const url = isGitRepo && (await hasOriginRemote(p)) ? await git(['remote', 'get-url', 'origin'], { cwd: p }) : null
  const originHead = isGitRepo ? await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: p }) : null
  const own = isGitRepo && !originHead?.ok ? await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: p }) : null
  const branch = originHead?.ok && originHead.stdout.startsWith('origin/') ? originHead.stdout.slice('origin/'.length) : own?.ok ? own.stdout : null
  return { isGitRepo, remoteUrl: url?.ok && url.stdout !== '' ? url.stdout : null, ghSignedIn, branch }
}

const GH_TTL_MS = 60_000
let gh: { at: number; signedIn: Promise<boolean> } | null = null

/** gh's sign-in from one `gh auth status`, kept for a minute (the Host has no GitHub poll to ask). */
export function ghSignedIn(nowMs: number = Date.now()): Promise<boolean> {
  if (gh === null || nowMs - gh.at >= GH_TTL_MS) gh = { at: nowMs, signedIn: probeGh().then((p) => p.kind === 'connected', () => false) }
  return gh.signedIn
}

const FOLDER_TTL_MS = 10_000
const folders = new Map<string, { at: number; setup: Promise<DeliverySetup> }>()

/** The Host's reader: the folder over the cached gh answer. Kept ten seconds per folder, as the loop asks every tick. */
export function readDeliverySetup(cwd: string, nowMs: number = Date.now()): Promise<DeliverySetup> {
  const hit = folders.get(cwd)
  if (hit !== undefined && nowMs - hit.at < FOLDER_TTL_MS) return hit.setup
  const setup = ghSignedIn(nowMs).then((signedIn) => readFolderSetup(cwd, signedIn))
  folders.set(cwd, { at: nowMs, setup })
  setup.catch(() => folders.delete(cwd))
  return setup
}
