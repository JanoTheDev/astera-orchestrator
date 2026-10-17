// Fork switch (orchestrator W0): auto-update and the remote policy.json are off unless the build is made with
// ASTERA_AUTO_UPDATE=1 (electron.vite.config.ts `define`), so this fork never downloads upstream releases.
// Undefined under vitest, which reads as off.
declare const __ASTERA_AUTO_UPDATE__: boolean | undefined

export const AUTO_UPDATE: boolean = typeof __ASTERA_AUTO_UPDATE__ === 'boolean' && __ASTERA_AUTO_UPDATE__
