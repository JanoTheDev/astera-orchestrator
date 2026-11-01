# Installs Astera on Windows silently and checks that it came back up (docs/getting-started.md, "Windows").
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Installer <path-to-astera-<ver>-setup.exe>] [-DryRun]
#
# Runs the NSIS installer with `/S --force-run`: silent, and the app is started again afterwards (build/installer.nsh).
# From Git Bash, `setup.exe /S` is rewritten by MSYS into a path and opens the wizard; this script has no such problem.
# -Installer defaults to the newest astera-*-setup.exe in Downloads. -DryRun prints the command it would run and stops.
param(
  [string]$Installer,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $Installer) {
  $newest = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'Downloads') -Filter 'astera-*-setup.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { throw 'install: no astera-*-setup.exe in Downloads; pass -Installer <path>' }
  $Installer = $newest.FullName
}
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "install: no installer at $Installer" }

$installerArgs = @('/S', '--force-run')
if ($DryRun) { Write-Output "$Installer $($installerArgs -join ' ')"; return }

$p = Start-Process -FilePath $Installer -ArgumentList $installerArgs -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "install: the installer exited with $($p.ExitCode)" }

$dir = Join-Path $env:LOCALAPPDATA 'Programs\Astera'
$app = Join-Path $dir 'Astera.exe'
if (-not (Test-Path -LiteralPath $app)) { throw "install: the installer did not put Astera at $app" }

# The relaunch is started by the shell and may land a moment after the installer returns.
$running = $false
for ($i = 0; $i -lt 20 -and -not $running; $i++) {
  $running = [bool](Get-Process -Name 'Astera' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'OrdinalIgnoreCase') })
  if (-not $running) { Start-Sleep -Milliseconds 500 }
}
$version = (Get-Item -LiteralPath $app).VersionInfo.ProductVersion
if (-not $running) { throw "install: Astera $version is installed but did not start; open it from the Start menu" }
Write-Output "Astera $version installed and running"
