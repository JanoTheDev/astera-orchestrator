// The plugin launcher's entry: out/main/plugin-host.js, which the Host runs with its own executable as Node, once per
// plugin (plugin runtime design P2, P9). Everything that must happen before a plugin's code loads happens here.
import { pathToFileURL } from 'node:url'
import { runLauncher } from './launcher'

// The Host starts this with ELECTRON_RUN_AS_NODE so its own binary runs as Node. A plugin, and anything it starts, must
// not inherit it: an Electron app a plugin opened would start as Node instead (the reason HOST_ONLY_ENV exists).
delete process.env.ELECTRON_RUN_AS_NODE

// stdout is the channel to the Host and nothing else (spec §14). The launcher keeps the one real writer; anything else
// that writes to stdout, console.log included, goes to stderr, which is the plugin's log.
const toHost = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

runLauncher({
  input: process.stdin,
  output: (line) => void toHost(line),
  log: (line) => void process.stderr.write(`${line}\n`),
  importEntry: (file) => import(pathToFileURL(file).href),
  // After what was written to the Host has left: on a pipe, a write is not done when write() returns.
  exit: (code) => void toHost('', () => process.exit(code))
})
