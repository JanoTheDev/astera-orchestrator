// scripts/install.ps1 (docs/getting-started.md, "Windows"). The argument building runs for real through -DryRun on
// Windows; off Windows there is no PowerShell to run, so that test is skipped and the text checks carry the contract.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const ps = readFileSync(join(here, 'install.ps1'), 'utf8')

describe('scripts/install.ps1', () => {
  it('stops at the first failure', () => expect(ps).toMatch(/^\$ErrorActionPreference = 'Stop'$/m))
  it('installs silently with --force-run, waiting for the installer', () => {
    expect(ps).toContain("@('/S', '--force-run')")
    expect(ps).toContain('-ArgumentList $installerArgs -Wait -PassThru')
  })
  it('checks the app is running afterwards', () => expect(ps).toContain("Get-Process -Name 'Astera'"))
  it.skipIf(process.platform !== 'win32')('-DryRun prints the command without running the installer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astera-install-'))
    try {
      const exe = join(dir, 'astera-9.9.9-setup.exe')
      writeFileSync(exe, 'not an installer')
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install.ps1'), '-Installer', exe, '-DryRun'],
        { encoding: 'utf8', windowsHide: true }
      )
      expect(out.trim()).toBe(`${exe} /S --force-run`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it.skipIf(process.platform !== 'win32')('-DryRun fails when the installer does not exist', () => {
    expect(() =>
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install.ps1'), '-Installer', join(tmpdir(), 'astera-none-setup.exe'), '-DryRun'], {
        stdio: 'pipe',
        windowsHide: true
      })
    ).toThrow()
  })
})
