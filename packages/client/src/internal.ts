// What the Astera app imports from the package beyond the published API (the app's publicContract module is the one
// door): the public field lists and their shaping, and the Host transport the app, the CLI and the SDK share. Not
// in the package's exports map, so a consumer of the published package cannot depend on it.
export * from './index.js'
export { ERROR_CODES, PLUGIN_ERROR_CODES, REMOTE_ERROR_CODES, codeForStatus, remoteCodeOf } from './errors.js'
export type { RemoteErrorCode } from './errors.js'
export * from './fields.js'
export { publicEvent, publicFor, shapeEvent } from './shape.js'
export * from './framing.js'
export * from './hostKey.js'
export * from './socketDir.js'
export * from './address.js'
export * from './discovery.js'
export * from './protocol.js'
export * from './connect.js'
export * from './deadlines.js'
export * from './follow.js'
export { createAsteraClientOver } from './client.js'
