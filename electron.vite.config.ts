import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { isNoise } from './electron.vite.warnings'

// CLI 는 Electron 없이 도는 번들이라(ELECTRON_RUN_AS_NODE) `app.getVersion()` 을 부를 수 없다.
// 앱과 CLI 는 한 프로그램이므로 버전도 하나여야 하고, 그 하나를 빌드가 박아 넣는다 — 두 곳에서
// 읽으면 갈라진다.
const version = (createRequire(import.meta.url)('./package.json') as { version: string }).version
// Fork: auto-update stays off unless built with ASTERA_AUTO_UPDATE=1 (src/core/update/autoUpdate.ts)
const autoUpdate = JSON.stringify(process.env.ASTERA_AUTO_UPDATE === '1')
// The source update channel (src/core/update/sourceUpdate.ts): the commit and the checkout this build came from.
// A self-update builds in a private clone and passes ASTERA_SOURCE_DIR, so the new app keeps watching the owner's
// checkout rather than the clone.
const sourceDir = process.env.ASTERA_SOURCE_DIR || dirname(fileURLToPath(import.meta.url))
let commit = ''
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).trim()
} catch {
  /* not a git checkout: the source channel stays off */
}

export default defineConfig({
  main: {
    define: {
      __ASTERA_VERSION__: JSON.stringify(version),
      __ASTERA_AUTO_UPDATE__: autoUpdate,
      __ASTERA_COMMIT__: JSON.stringify(commit),
      __ASTERA_SOURCE_DIR__: JSON.stringify(sourceDir)
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // zod's prose about @__PURE__ reads to Rollup as a misplaced annotation on every build: see electron.vite.warnings.ts
        onwarn(warning, warn) {
          if (!isNoise(warning)) warn(warning)
        },
        input: {
          index: 'src/main/index.ts',
          cli: 'src/cli/index.ts',
          host: 'src/host/index.ts',
          'plugin-host': 'src/pluginHost/index.ts'
        }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    define: { __ASTERA_AUTO_UPDATE__: autoUpdate },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
