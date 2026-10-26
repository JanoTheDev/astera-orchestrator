// The published surface, pinned: an accidental export fails here. A deliberate one is added to this list, to
// docs/sdk.md and to the changelog. The error helpers the app needs live in internal.ts, not here.
import { describe, it, expect } from 'vitest'
import * as pkg from './index.js'

describe('the package index', () => {
  it('exports exactly the documented names', () => {
    expect(Object.keys(pkg).sort()).toEqual([
      'AsteraError',
      'CLIENT_VERSION',
      'DEFAULT_CALL_TIMEOUT_MS',
      'DEFAULT_CONNECT_TIMEOUT_MS',
      'EXIT_CODES',
      'bodyCodeOf',
      'createAsteraClient',
      'isAsteraError'
    ])
  })
})
