// What the plugin SDK's build sees of @astera-app/client. The emitted declarations keep the import by package name,
// so a plugin that installs the client gets its real types; this stands in only while tsc emits, so the SDK builds
// without the client's own build output (tsconfig.json checks the SDK against the client's real source).
export interface AsteraClient {}
export interface AsteraEvent {}
export interface EventGap {}
