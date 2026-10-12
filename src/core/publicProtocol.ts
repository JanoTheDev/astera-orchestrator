// The second door into the SDK package (packages/client), and the only one the renderer may reach: the Host
// protocol's client messages and constants (packages/client/src/protocol.ts), a module that imports nothing.
// publicContract.ts, the main door, also carries the Node-only transport (node:crypto, node:fs, node:net), which a
// renderer bundle must never pull in.
export * from '../../packages/client/src/protocol.js'
