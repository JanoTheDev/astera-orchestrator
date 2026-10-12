// The app reads the public contract from the SDK package (packages/client), one copy for the CLI, MCP and the SDK.
import { describe, it, expect } from 'vitest'
import * as pkg from '../../packages/client/src/index.js'
import * as cliOutput from './orchestration/cliOutput'

describe('the app uses the package contract', () => {
  it('the CLI error codes and their mapping are the package ones', () => {
    expect(cliOutput.CLI_ERROR_CODES).toBe(pkg.ERROR_CODES)
    expect(cliOutput.REMOTE_ERROR_CODES).toBe(pkg.REMOTE_ERROR_CODES)
    expect(cliOutput.codeForStatus).toBe(pkg.codeForStatus)
    expect(cliOutput.exitCodeFor).toBe(pkg.exitCodeFor)
    expect(cliOutput.remoteCodeOf).toBe(pkg.remoteCodeOf)
  })
})
