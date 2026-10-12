// The second door into the SDK package (packages/client), and the only one the renderer may reach: the Host
// protocol's client messages and constants (packages/client/src/protocol.ts) and the call deadlines
// (packages/client/src/deadlines.ts), modules that import nothing. publicContract.ts, the main door, also carries the
// Node-only transport (node:crypto, node:fs, node:net), which a renderer bundle must never pull in.
export * from '../../packages/client/src/protocol.js'
export * from '../../packages/client/src/deadlines.js'
