// Stands in for @astera-app/client in tsconfig.web.json only (its `paths`): the plugin SDK's index imports three client
// types for the plugin context, and the renderer reads none of them. The real package pulls node: modules into the
// renderer program; tsconfig.node.json maps the name to the real one.
export type AsteraClient = unknown
export type AsteraEvent = unknown
export type EventGap = unknown
