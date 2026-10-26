// The error contract of everything Astera answers to a script: the `astera` CLI, its MCP server and the SDK
// (public CLI design §7-§8, remote runtime design §3.10). A message is for a person; the code is for the machine.
//
// **A closed set, and the list is the type.** `EXIT_CODES` is a `Record` over it, so adding a code breaks the
// compile until the code has an exit code; the app's own tables over the same type (the CLI's next steps) break the
// same way.

/** The remote runtime's codes (design §3.10), as a Runtime's controller gate and the controller link name them. */
export const REMOTE_ERROR_CODES = Object.freeze([
  'RUNTIME_NOT_FOUND',
  'RUNTIME_OFFLINE',
  'RUNTIME_AUTH_FAILED',
  'RUNTIME_IDENTITY_CHANGED',
  'RUNTIME_PROTOCOL_MISMATCH',
  'RUNTIME_PROJECT_NOT_FOUND',
  'RUNTIME_ACCOUNT_NOT_FOUND',
  'RUNTIME_CAPABILITY_MISSING',
  'RUNTIME_BUSY',
  'RUNTIME_PERMISSION_DENIED',
  'RUNTIME_OUTCOME_UNKNOWN',
  'REMOTE_TIMEOUT',
  'REMOTE_OPERATION_CONFLICT',
  'REMOTE_REPLY_TOO_LARGE'
] as const)
export type RemoteErrorCode = (typeof REMOTE_ERROR_CODES)[number]

/** The plugins' codes: `PLUGIN_CAPABILITY_MISSING`, a Task's check names a plugin that is not installed, does not offer
 *  completion checks, or is disabled (Astera 1.4.14). */
export const PLUGIN_ERROR_CODES = Object.freeze(['PLUGIN_CAPABILITY_MISSING'] as const)

export const ERROR_CODES = Object.freeze([
  'FAILED',
  'INVALID_ARGUMENTS',
  'HOST_NOT_RUNNING',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'CONFLICT',
  'TIMEOUT',
  'WAITING_FOR_INPUT',
  'VERSION_MISMATCH',
  'RUN_FAILED',
  // A controller's answers from a paired Runtime. Each exits as its nearest local code, so a script that branches
  // on the exit keeps working and one that reads the code can tell them apart.
  ...REMOTE_ERROR_CODES,
  // The same for the plugins' codes
  ...PLUGIN_ERROR_CODES
] as const)
export type AsteraErrorCode = (typeof ERROR_CODES)[number]

/** One exit code per code: the public CLI design's §8 table is this object, so it cannot be written twice. */
export const EXIT_CODES: Readonly<Record<AsteraErrorCode, number>> = Object.freeze({
  FAILED: 1,
  INVALID_ARGUMENTS: 2,
  HOST_NOT_RUNNING: 3,
  NOT_FOUND: 4,
  PERMISSION_DENIED: 5,
  CONFLICT: 6,
  TIMEOUT: 7,
  WAITING_FOR_INPUT: 8,
  VERSION_MISMATCH: 9,
  RUN_FAILED: 10,
  RUNTIME_NOT_FOUND: 4,
  RUNTIME_OFFLINE: 3,
  RUNTIME_AUTH_FAILED: 5,
  RUNTIME_IDENTITY_CHANGED: 5,
  RUNTIME_PROTOCOL_MISMATCH: 9,
  RUNTIME_PROJECT_NOT_FOUND: 4,
  RUNTIME_ACCOUNT_NOT_FOUND: 4,
  RUNTIME_CAPABILITY_MISSING: 9,
  RUNTIME_BUSY: 6,
  RUNTIME_PERMISSION_DENIED: 5,
  RUNTIME_OUTCOME_UNKNOWN: 6,
  REMOTE_TIMEOUT: 7,
  REMOTE_OPERATION_CONFLICT: 6,
  REMOTE_REPLY_TOO_LARGE: 1,
  PLUGIN_CAPABILITY_MISSING: 6
})

/** The remote code a Runtime's refusal names in its body (`{ code }`), or null. Read from the field, never the
 *  sentence (§3.10). */
export const remoteCodeOf = (body: unknown): RemoteErrorCode | null => {
  const code = bodyCodeOf(body)
  return code !== null && (REMOTE_ERROR_CODES as readonly string[]).includes(code) ? (code as RemoteErrorCode) : null
}

/** The codes a refusal may name in its body: the remote ones and the plugins' ones. */
const BODY: ReadonlySet<string> = new Set([...REMOTE_ERROR_CODES, ...PLUGIN_ERROR_CODES])

/** The code a refusal names in its body (`{ code }`), remote or a plugin's, or null. Read from the field, never the
 *  sentence: the status then gives the code (`codeForStatus`). */
export const bodyCodeOf = (body: unknown): AsteraErrorCode | null => {
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
  return typeof code === 'string' && BODY.has(code) ? (code as AsteraErrorCode) : null
}

/**
 * The Host's HTTP-like status as a code.
 *
 * The Host already tells 400, 403, 404, 409 and 501 apart, so this carries those five over and calls everything
 * else a plain failure: **an unknown status is never guessed into a plausible code**, because a script branches on
 * the code and a guess makes that branch silently wrong.
 *
 * **501 is an unknown command, not an unknown id.** The Host does not know the command, which means the caller is a
 * newer build than the Host, and what a script needs to see is "the versions differ", not "a typo". An older,
 * already shipped Host answers an unknown command with 404 instead: that one lands on NOT_FOUND, and its message says
 * what happened. The code is never picked by reading the message: that would tie the contract to a sentence.
 */
export function codeForStatus(status: number): AsteraErrorCode {
  if (status === 400) return 'INVALID_ARGUMENTS'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 501) return 'VERSION_MISMATCH'
  return 'FAILED'
}

/** The mark every AsteraError carries. `Symbol.for` makes it the same in every copy of the package, so an error made
 *  by the CommonJS copy is an AsteraError to the ESM copy's class and back (an application on ESM with a dependency
 *  on CommonJS holds both). */
const BRAND = Symbol.for('@astera-app/client/AsteraError')

/** What the SDK throws: the same codes the CLI and MCP answer with. `details` is there only when given. Test with
 *  `isAsteraError(e)` or `e instanceof AsteraError`; both read the brand, not the class. */
export class AsteraError extends Error {
  readonly code: AsteraErrorCode
  // `declare`: an ES2022 class field would define `details` as undefined on every error, given or not
  declare readonly details?: unknown
  constructor(code: AsteraErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AsteraError'
    this.code = code
    if (details !== undefined) this.details = details
    Object.defineProperty(this, BRAND, { value: true })
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return isAsteraError(value)
  }
}

/** Whether `value` is an AsteraError from any copy of this package. */
export function isAsteraError(value: unknown): value is AsteraError {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[BRAND] === true
}
