#!/usr/bin/env pwsh
#
# Builds the treflex client beside the dist it serves and swaps it in, so a failed build leaves the
# running client alone. dev-stack.ps1 calls it for the driver.
#
#   driver-build.ps1 -Build -StateDir <dir>     build into <dir>\treflex-next; exits 1 on failure, output in <dir>\treflex-build.log
#   driver-build.ps1 -Install -StateDir <dir>   swap <dir>\treflex-next into dist, with the client stopped; no-op without one
#   driver-build.ps1 -Verify -Port <port>       exits 0 when the port serves dist\index.html
[CmdletBinding()]
param(
  [Parameter(Mandatory, ParameterSetName = "Build")]
  [switch]$Build,
  [Parameter(Mandatory, ParameterSetName = "Install")]
  [switch]$Install,
  [Parameter(Mandatory, ParameterSetName = "Verify")]
  [switch]$Verify,
  [Parameter(Mandatory, ParameterSetName = "Build")]
  [Parameter(Mandatory, ParameterSetName = "Install")]
  [string]$StateDir,
  [Parameter(Mandatory, ParameterSetName = "Verify")]
  [int]$Port
)

$ErrorActionPreference = "Stop"
$appDir = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $appDir "dist"

if ($Build) {
  $next = Join-Path $StateDir "treflex-next"
  $log = Join-Path $StateDir "treflex-build.log"
  if (Test-Path $next) { Remove-Item -Recurse -Force $next }
  Write-Host "treflex: building"
  # A baked-in origin breaks every browser that reaches the client through Tailscale.
  Remove-Item Env:VITE_HTTP_URL, Env:VITE_WS_URL -ErrorAction SilentlyContinue
  Push-Location $appDir
  try {
    # Windows PowerShell 5.1 turns a native command's redirected stderr into errors, which "Stop" would throw on.
    $ErrorActionPreference = "Continue"
    & (Get-Command vp).Source build --outDir $next --emptyOutDir *> $log
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -eq 0 -and (Test-Path (Join-Path $next "sw.js"))) { exit 0 }
  if (Test-Path $next) { Remove-Item -Recurse -Force $next }
  Write-Warning "treflex: build failed, so the running client and dist are unchanged. See $log"
  exit 1
}

# Windows can't rename a folder the preview server holds open.
if ($Install) {
  $next = Join-Path $StateDir "treflex-next"
  if (-not (Test-Path $next)) { exit 0 }
  $old = Join-Path $StateDir "treflex-old"
  if (Test-Path $old) { Remove-Item -Recurse -Force $old }
  if (Test-Path $dist) { Move-Item $dist $old }
  try {
    Move-Item $next $dist
  } catch {
    if (Test-Path $old) { Move-Item $old $dist }
    throw
  }
  if (Test-Path $old) { Remove-Item -Recurse -Force $old }
  exit 0
}

if ($Verify) {
  $served = (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10).Content
  if ($served -eq (Get-Content (Join-Path $dist "index.html") -Raw)) {
    "treflex: serving the build in $dist"
    exit 0
  }
  Write-Warning "treflex: port $Port answers but doesn't serve $dist\index.html"
  exit 1
}
