// Newline-delimited JSON, one object per line, both directions (design §6). The framing is the SDK package's
// (packages/client/src/framing.ts): the Host, the app, the CLI and @astera-app/client read and write one format.
export { createLineReader, encodeLine } from '../core/publicContract'
