# Makes this Windows machine an Astera Runtime in one command (docs/remote-runtime.md, "One-command setup").
#
#   powershell -ExecutionPolicy Bypass -File install-runtime.ps1 -Installer <path-to-Astera-Setup.exe> [-Listen <addr>] [-Tailscale] [-Name <n>] [-FullControl] [-Codex]
#
# Installs Astera silently for this user, then runs `astera runtime setup --yes` with the flags given. The last line it
# prints is ASTERA_PAIR=<pairing string>: give that string to the controller and to nothing else, it holds a one-time code.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$Listen,
  [string]$Name,
  [switch]$Tailscale,
  [switch]$FullControl,
  [switch]$Codex
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "install-runtime: no installer at $Installer" }

# /S: the NSIS installer's silent mode, for this user (no administrator).
$p = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "install-runtime: the installer exited with $($p.ExitCode)" }

$dir = Join-Path $env:LOCALAPPDATA 'Programs\Astera'
$app = Join-Path $dir 'Astera.exe'
$cli = Join-Path $dir 'resources\app.asar\out\main\cli.js'
if (-not (Test-Path -LiteralPath $app)) { throw "install-runtime: the installer did not put Astera at $app" }

$flags = @('runtime', 'setup', '--yes', '--json')
if ($Listen) { $flags += @('--listen', $Listen) }
if ($Name) { $flags += @('--name', $Name) }
if ($Tailscale) { $flags += '--tailscale' }
if ($FullControl) { $flags += '--full-control' }
if ($Codex) { $flags += '--codex' }

# The app's own binary as Node, no window. Steps go to stderr, the JSON answer to $out.
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  $out = (& $app $cli @flags | Out-String)
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
if ($code -ne 0) {
  [Console]::Error.WriteLine($out)
  throw "install-runtime: astera runtime setup failed (exit $code)"
}
$pair = [string](ConvertFrom-Json $out).data.pairing
if (-not $pair.StartsWith('astera-pair:v1:')) { throw 'install-runtime: setup answered without a pairing string' }
Write-Output "ASTERA_PAIR=$pair"
