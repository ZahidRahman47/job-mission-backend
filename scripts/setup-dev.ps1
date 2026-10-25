<#
.SYNOPSIS
  One-shot Windows dev environment setup for Mission Control.
  Installs Git, Node.js LTS and pnpm (via corepack). No Docker and no local MongoDB:
  development uses a MongoDB Atlas cluster, tests use mongodb-memory-server (ADR-012).
  Safe to re-run: anything already installed is skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1 -GitName "Your Name" -GitEmail "you@example.com"
#>
param(
  [string]$GitName,
  [string]$GitEmail,
  [string]$LogPath,     # optional: write a transcript here (useful when run unattended)
  [switch]$NoPause,     # don't wait for Enter before closing the elevated window
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'

# --- 1. Re-launch as administrator if needed (installers and corepack need it) ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Requesting administrator rights...' -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  if ($GitName)  { $argList += @('-GitName',  "`"$GitName`"") }
  if ($GitEmail) { $argList += @('-GitEmail', "`"$GitEmail`"") }
  if ($LogPath)  { $argList += @('-LogPath',  "`"$LogPath`"") }
  if ($NoPause)  { $argList += '-NoPause' }
  Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
  exit
}

if ($LogPath) { Start-Transcript -Path $LogPath -Force | Out-Null }

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Refresh-Path {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH', 'User')
}
function Install-WingetPackage($id) {
  winget list --id $id -e --accept-source-agreements *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "  $id already installed, skipping"; return }
  Write-Host "  installing $id ..."
  winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed to install $id (exit $LASTEXITCODE)" }
}

try {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.'
  }

  # --- 2. Git, Node.js LTS ---
  Step 'Git';         Install-WingetPackage 'Git.Git'
  Step 'Node.js LTS'; Install-WingetPackage 'OpenJS.NodeJS.LTS'
  # The in-memory MongoDB used by the test suite is a Windows binary that needs the MSVC runtime.
  Step 'Visual C++ runtime (for tests)'; Install-WingetPackage 'Microsoft.VCRedist.2015+.x64'
  Refresh-Path

  # --- 3. pnpm via corepack (Node 25+ no longer bundles corepack, so install it if missing) ---
  Step 'pnpm (via corepack)'
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    npm install -g corepack
    Refresh-Path
  }
  corepack enable
  corepack prepare pnpm@latest --activate
  Refresh-Path

  # --- 4. Git identity ---
  Step 'Git identity'
  if ($GitName)  { git config --global user.name  $GitName }
  if ($GitEmail) { git config --global user.email $GitEmail }
  git config --global init.defaultBranch main
  git config --global core.autocrlf input
  if (-not (git config --global user.name)) { Write-Host '  user.name not set: re-run with -GitName "Your Name"' -ForegroundColor Yellow }

  # --- 5. Summary ---
  Step 'Versions'
  foreach ($t in 'node', 'pnpm', 'git') {
    $cmd = Get-Command $t -ErrorAction SilentlyContinue
    if ($cmd) { '  {0,-5} {1}' -f $t, ((& $t --version) | Select-Object -First 1) }
    else      { '  {0,-5} not on PATH yet (open a new terminal)' -f $t }
  }

  Write-Host "`nDone. Next: put your Atlas connection string in apps/api/.env (see README)." -ForegroundColor Green
}
catch {
  Write-Host "`nSETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($LogPath) { Stop-Transcript | Out-Null }
  if ($Elevated -and -not $NoPause) { Read-Host "`nPress Enter to close this window" }
}
