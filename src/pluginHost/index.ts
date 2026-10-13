// The plugin launcher's entry: out/main/plugin-host.js, which the Host runs with its own executable as Node, once per
// plugin (plugin runtime design P2, P9). Everything that must happen before a plugin's code loads happens here.
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { runLauncher } from './launcher'

// The Host starts this with ELECTRON_RUN_AS_NODE so its own binary runs as Node. A plugin, and anything it starts, must
// not inherit it: an Electron app a plugin opened would start as Node instead (the reason HOST_ONLY_ENV exists).
delete process.env.ELECTRON_RUN_AS_NODE

// The channel to the Host is the fourth pipe (fd 3), not stdout (2b final review I1): a child that inherits stdio gets
// only 0 to 2, so nothing the plugin or its children print can reach the channel. stdout and stderr are its log.
const channel = new net.Socket({ fd: 3, readable: true, writable: true })
channel.on('error', (e) => process.stderr.write(`[launcher] the channel to the Host failed: ${e.message}\n`))

/** Exits once what was written to the Host has left: on a pipe a write is not done when write() returns, and writes
 *  are done in order, so an empty write's callback comes after every line before it. Not end(): shutting a Windows
 *  pipe down waits for the other end and holds the event loop with it (measured: no timer ran until it was killed). */
const exitAfterFlush = (code: number): void => {
  setTimeout(() => process.exit(code), 1000).unref()
  if (channel.writableEnded || channel.destroyed) process.exit(code)
  else channel.write('', () => process.exit(code))
}

runLauncher({
  input: channel,
  output: (line) => {
    if (!channel.destroyed && !channel.writableEnded) channel.write(line)
  },
  log: (line) => void process.stderr.write(`${line}\n`),
  importEntry: (file) => import(pathToFileURL(file).href),
  exit: exitAfterFlush
})
