// The two one-command Runtime installers (docs/remote-runtime.md, "One-command setup"). The shell script is parsed by
// bash itself; PowerShell is not on every CI machine, so the ps1 is held to the lines its contract rests on.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(join(here, f), 'utf8')
/** The last line that is not blank, a comment or a closing brace. */
const lastStatement = (text, comment) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith(comment) && l !== '}' && l !== 'fi')
    .pop()

describe('scripts/install-runtime.sh', () => {
  const sh = read('install-runtime.sh')
  it('parses (bash -n)', () => {
    expect(() => execFileSync('bash', ['-n', join(here, 'install-runtime.sh')])).not.toThrow()
  })
  it('stops at the first failure', () => expect(sh).toMatch(/^set -euo pipefail$/m))
  it('installs the .deb with apt, then runs setup headless with --yes and the flags given', () => {
    expect(sh).toContain('sudo apt-get install -y "$deb"')
    expect(sh).toMatch(/ELECTRON_RUN_AS_NODE=1 "\$app" "\$cli" runtime setup --yes --json "\$@"/)
  })
  it('refuses root: the Runtime belongs to a user', () => expect(sh).toMatch(/id -u\)" -ne 0/))
  it('prints the pairing string as its last line', () => expect(lastStatement(sh, '#')).toBe('echo "ASTERA_PAIR=$pair"'))
  it('writes no secret anywhere but that line', () => {
    expect(sh).not.toMatch(/token|password/i)
    expect(sh.match(/\$pair/g)).toHaveLength(2)
  })
})

describe('scripts/install-runtime.ps1', () => {
  const ps = read('install-runtime.ps1')
  it('stops at the first failure', () => expect(ps).toMatch(/^\$ErrorActionPreference = 'Stop'$/m))
  it('takes the installer and the setup flags as parameters', () => {
    expect(ps).toMatch(/\[Parameter\(Mandatory = \$true\)\]\[string\]\$Installer/)
    for (const p of ['$Listen', '$Name', '$Tailscale', '$FullControl', '$Codex']) expect(ps).toContain(p)
  })
  it('installs silently, then runs setup headless with --yes', () => {
    expect(ps).toContain("-ArgumentList '/S' -Wait -PassThru")
    expect(ps).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
    expect(ps).toContain("@('runtime', 'setup', '--yes', '--json')")
  })
  it('balances its braces and parentheses', () => {
    const code = ps.replace(/'[^']*'|"[^"]*"/g, '').replace(/#[^\n]*/g, '')
    for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) expect(code.split(o).length).toBe(code.split(c).length)
  })
  it('prints the pairing string as its last line', () => expect(lastStatement(ps, '#')).toBe('Write-Output "ASTERA_PAIR=$pair"'))
})
