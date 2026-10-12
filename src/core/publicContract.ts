// The SDK's public contract (packages/client, published as @astera-app/client) as the app reads it. The app imports
// the package; the package never imports the app (packages/client/src/fence.test.ts). One copy for the CLI, MCP and
// the SDK.
export * from '../../packages/client/src/index.js'
