// The plugin SDK's contract (packages/plugin-sdk, @astera-app/plugin-sdk) as the app reads it. The app imports the
// package through this module alone (pluginContract.test.ts); the package never imports the app. One copy of the
// notification kinds, the check input, the job-source shapes and the API version. The package index has no runtime
// import and no `node:` import, so the renderer and the Host bundle can load this module.
export * from '../../packages/plugin-sdk/src/index'
