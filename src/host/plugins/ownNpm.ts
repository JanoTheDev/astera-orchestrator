// An npm of Astera's own, for a computer without Node.js (plugins 2e-2; the user's decision 2026-10-13): npm 11.21.0,
// fetched once from the npm registry when an install from npm finds no npm to run, checked against the hash pinned
// here (the trust anchor: the bytes are refused unless they are the npm the registry published), extracted with the
// Host's own tar reader into `<profile>/plugins/npm/<version>`, and run on the Host's own Node. When the fetch fails,
// the reason says which of three it was, since a person on a company network needs to hear that the network blocks it.
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { extractPackage } from './tarball'
import { moveRetrying } from './moves'
import { pluginsRoot } from './registry'

export interface OwnNpmPin {
  version: string
  /** The registry's `dist.integrity` for that version. */
  integrity: string
  url: string
}

/** npm 11 rather than 12: it runs on Node 20.17 and 22.9 up, so a change of the Node inside Astera cannot strand it. */
export const OWN_NPM: OwnNpmPin = {
  version: '11.21.0',
  integrity: 'sha512-Zov8KhamNneiLdELtj5YALtNmJW4L4fCLTzjfpzXG2w6MSHcf0UxgdlK5uloCuksWT+7mGUU7wi79cO6RqivPg==',
  url: 'https://registry.npmjs.org/npm/-/npm-11.21.0.tgz'
}

/** Astera's own npm could not be had: the registry did not answer or refused (blocked), the bytes were not the npm
 *  pinned (altered), or it could not be set up on disk (failed). Each code has words of its own in the app. */
export class NpmUnavailable extends Error {
  constructor(
    readonly code: 'PLUGIN_NPM_BLOCKED' | 'PLUGIN_NPM_ALTERED' | 'PLUGIN_NPM_FETCH_FAILED',
    message: string
  ) {
    super(message)
  }
}

const FETCH_TIMEOUT_MS = 60_000
/** npm is 3 MiB; a body past this is not it. */
const DOWNLOAD_MAX = 64 * 1024 * 1024
/** Written last into a fetched npm: a folder without it was left half written by a Host that stopped. */
const MARK = '.astera-npm'
const ALTERNATIVES = 'install Node.js, which brings npm, or install the plugin from a folder with --path'

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

/** Why a request did not answer, as briefly as Node says it: the system's code (ECONNREFUSED, ENOTFOUND, a
 *  certificate's), or its message. */
const reasonOf = (e: unknown): string => {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : e instanceof Error && e.message !== '' ? e.message : 'no reason given'
}

/** How many redirects are followed: a registry may move a tarball; a captive portal's page is refused by its hash. */
const REDIRECTS_MAX = 3

export function createOwnNpm(d: { profileDir: string; pinned?: OwnNpmPin }): { ensure(): Promise<string> } {
  const pin = d.pinned ?? OWN_NPM
  const root = path.join(pluginsRoot(d.profileDir), 'npm')
  const dir = path.join(root, pin.version)
  const cli = path.join(dir, 'bin', 'npm-cli.js')
  const host = new URL(pin.url).host
  const blocked = (why: string): NpmUnavailable =>
    new NpmUnavailable(
      'PLUGIN_NPM_BLOCKED',
      `npm is not installed, and Astera could not fetch its own npm ${pin.version}: ${host} ${why}. A company network, a firewall or a proxy may block it: ask for access to ${host}, ${ALTERNATIVES}`
    )
  const altered = (): NpmUnavailable =>
    new NpmUnavailable(
      'PLUGIN_NPM_ALTERED',
      `npm is not installed, and the npm ${pin.version} Astera fetched is not the one it expects (its hash differs), so it was not used: something on the network may have changed it. Install Node.js, which brings npm, or install the plugin from a folder with --path`
    )

  /** The bytes at `url`. A plain request rather than fetch, which turns a proxy's 407 into a network error and so
   *  hides the one answer that says a proxy is in the way. */
  const download = (url: string, redirects = 0): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const get = url.startsWith('https:') ? https.get : http.get
      const req = get(url, (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && typeof res.headers.location === 'string' && redirects < REDIRECTS_MAX) {
          res.resume()
          return void download(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject)
        }
        if (status !== 200) {
          res.resume()
          return void reject(blocked(`answered ${status}`))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > DOWNLOAD_MAX) {
            req.destroy()
            reject(altered())
          } else chunks.push(c)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', (e) => reject(blocked(`stopped answering (${reasonOf(e)})`)))
      })
      req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(Object.assign(new Error(`no answer within ${FETCH_TIMEOUT_MS / 1000} s`), { code: undefined })))
      req.on('error', (e) => reject(blocked(`did not answer (${reasonOf(e)})`)))
    })

  async function fetchIt(): Promise<string> {
    if ((await exists(path.join(dir, MARK))) && (await exists(cli))) return cli
    const body = await download(pin.url)
    if (`sha512-${createHash('sha512').update(body).digest('base64')}` !== pin.integrity) throw altered()
    await fs.mkdir(root, { recursive: true })
    // What a Host that stopped half way left goes first.
    for (const n of await fs.readdir(root)) if (n.startsWith('.staging-')) await fs.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {})
    const staging = path.join(root, `.staging-${randomBytes(6).toString('hex')}`)
    try {
      await fs.mkdir(staging)
      await fs.writeFile(path.join(staging, 'npm.tgz'), body)
      await extractPackage(path.join(staging, 'npm.tgz'), path.join(staging, 'npm'))
      await fs.writeFile(path.join(staging, 'npm', MARK), `${pin.integrity}\n`)
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 })
      await moveRetrying(path.join(staging, 'npm'), dir)
    } catch (e) {
      throw new NpmUnavailable(
        'PLUGIN_NPM_FETCH_FAILED',
        `npm is not installed, and Astera could not set up its own npm ${pin.version}: ${e instanceof Error ? e.message : String(e)}. Install Node.js, which brings npm, or install the plugin from a folder with --path`
      )
    } finally {
      await fs.rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    }
    return cli
  }

  let pending: Promise<string> | null = null
  return {
    // Two installs at once share one fetch.
    ensure: () =>
      (pending ??= fetchIt().finally(() => {
        pending = null
      }))
  }
}
