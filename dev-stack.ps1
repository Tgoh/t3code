#!/usr/bin/env pwsh
#
#   ./dev-stack.ps1           start whatever isn't already running
#   ./dev-stack.ps1 -Status   show what's running
#   ./dev-stack.ps1 -Stop     stop what this script started
#   ./dev-stack.ps1 -Restart  stop, then start
#   ./dev-stack.ps1 -Restart -Only reflex   restart one service (server, reflex or stock)
#
# The reflex client is a production build served by `vp preview`, rebuilt whenever it starts. A failed
# build leaves the running client and apps/reflex-web/dist alone and exits 1.
#
# Starting and stopping run elevated: an unelevated run reopens itself as administrator.
[CmdletBinding()]
param(
  [switch]$Status,
  [switch]$Stop,
  [switch]$Restart,
  [ValidateSet("server", "reflex", "stock")]
  [string]$Only,
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $Status -and -not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Pause")
  if ($Stop) { $arguments += "-Stop" }
  if ($Restart) { $arguments += "-Restart" }
  if ($Only) { $arguments += @("-Only", $Only) }
  Start-Process (Get-Process -Id $PID).Path -Verb RunAs -ArgumentList $arguments
  "Continuing in an administrator window."
  return
}

$root = $PSScriptRoot
$homeDir = Join-Path (Split-Path $root -Parent) "t3code-dev-home"
$stateDir = Join-Path $homeDir "dev-stack"
$statePath = Join-Path $stateDir "processes.json"
$node = (Get-Command node).Source
$vp = (Get-Command vp).Source

$services = @(
  @{
    Name = "server"
    Port = 13773
    File = $node
    Arguments = @("src/bin.ts", "--port", "13773", "--base-dir", "`"$homeDir`"", "--no-browser")
    Directory = Join-Path $root "apps/server"
  },
  @{
    Name = "reflex"
    Port = 5734
    File = $vp
    Arguments = @("preview", "--port", "5734", "--strictPort")
    Directory = Join-Path $root "apps/reflex-web"
  },
  @{
    Name = "stock"
    Port = 5733
    File = $vp
    Arguments = @("run", "dev:web")
    Directory = $root
  }
)
if ($Only) { $services = @($services | Where-Object { $_.Name -eq $Only }) }

# Each address on its own: Windows retries a refused ::1 for about two seconds before trying IPv4 for
# "localhost", and the server listens on IPv4 only while Vite can listen on either.
function Test-Port([int]$port) {
  foreach ($address in "127.0.0.1", "::1") {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      if ($client.ConnectAsync($address, $port).Wait(500) -and $client.Connected) { return $true }
    } catch {
    } finally {
      $client.Dispose()
    }
  }
  $false
}

function Read-State {
  if (-not (Test-Path $statePath)) { return @{} }
  $held = @{}
  (Get-Content $statePath -Raw | ConvertFrom-Json).PSObject.Properties |
    ForEach-Object { $held[$_.Name] = $_.Value }
  $held
}

# A stored id can be reused by an unrelated process after a reboot, so the start time has to match too.
function Get-StartedProcess($entry) {
  if ($null -eq $entry) { return $null }
  $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  if ($process.StartTime.ToUniversalTime().Ticks -ne $entry.StartedAt) { return $null }
  $process
}

function Show-Status {
  $state = Read-State
  foreach ($service in $services) {
    $listening = Test-Port $service.Port
    $owned = $null -ne (Get-StartedProcess $state[$service.Name])
    $text = if ($listening -and $owned) { "running" }
      elseif ($listening) { "running, not started by this script" }
      elseif ($owned) { "starting or stuck" }
      else { "stopped" }
    "{0,-7} {1,-6} {2}" -f $service.Name, $service.Port, $text
  }
}

if ($Status) {
  Show-Status
  return
}

function Stop-Stack {
  $state = Read-State
  foreach ($service in $services) {
    $process = Get-StartedProcess $state[$service.Name]
    if ($null -eq $process) {
      "{0}: nothing of ours to stop" -f $service.Name
      continue
    }
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    "{0}: stopped" -f $service.Name
  }
  foreach ($service in $services) { $state.Remove($service.Name) }
  $state | ConvertTo-Json | Set-Content $statePath
}

if ($Stop) {
  Stop-Stack
  if ($Pause) { Read-Host "Press Enter to close" | Out-Null }
  return
}

$reflexDir = Join-Path $root "apps/reflex-web"
$dist = Join-Path $reflexDir "dist"
$nextBuild = Join-Path $stateDir "reflex-next"
$buildFailed = $false

function Build-Reflex {
  $log = Join-Path $stateDir "reflex-build.log"
  if (Test-Path $nextBuild) { Remove-Item -Recurse -Force $nextBuild }
  Write-Host "reflex: building"
  # A baked-in origin breaks every browser that reaches the client through Tailscale.
  Remove-Item Env:VITE_HTTP_URL, Env:VITE_WS_URL -ErrorAction SilentlyContinue
  Push-Location $reflexDir
  try {
    & $vp build --outDir $nextBuild --emptyOutDir *> $log
    $built = $LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $nextBuild "sw.js"))
  } finally {
    Pop-Location
  }
  if ($built) { return $true }
  if (Test-Path $nextBuild) { Remove-Item -Recurse -Force $nextBuild }
  Write-Warning "reflex: build failed, so the running client and dist are unchanged. See $log"
  $false
}

# Runs with the client stopped: Windows can't rename a folder the preview server holds open.
function Install-ReflexBuild {
  $old = Join-Path $stateDir "reflex-old"
  if (Test-Path $old) { Remove-Item -Recurse -Force $old }
  if (Test-Path $dist) { Move-Item $dist $old }
  try {
    Move-Item $nextBuild $dist
  } catch {
    if (Test-Path $old) { Move-Item $old $dist }
    throw
  }
  if (Test-Path $old) { Remove-Item -Recurse -Force $old }
}

function Test-ReflexServed {
  $served = (Invoke-WebRequest "http://localhost:5734/" -UseBasicParsing -TimeoutSec 10).Content
  $served -eq (Get-Content (Join-Path $dist "index.html") -Raw)
}

New-Item -ItemType Directory -Force $stateDir | Out-Null
$reflex = $services | Where-Object { $_.Name -eq "reflex" }
if ($reflex -and ($Restart -or -not (Test-Port $reflex.Port))) {
  if (-not (Build-Reflex)) {
    $buildFailed = $true
    if ($Restart -or -not (Test-Path (Join-Path $dist "index.html"))) {
      $services = @($services | Where-Object { $_.Name -ne "reflex" })
    } else {
      "reflex: serving the previous build"
    }
  }
}

if ($Restart) {
  Stop-Stack
  foreach ($service in $services) {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Test-Port $service.Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  }
}

if (-not (Test-Path (Join-Path $root "apps/web/dist/index.html"))) {
  Write-Warning "apps/web/dist is missing, so outside agents can't sign in. Run 'vp build' in apps/web, then restart."
}

$hidden = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$state = Read-State
$started = @()
foreach ($service in $services) {
  if (Test-Port $service.Port) {
    "{0}: already running on {1}" -f $service.Name, $service.Port
    continue
  }
  if ($service.Name -eq "reflex" -and (Test-Path $nextBuild)) { Install-ReflexBuild }
  $log = Join-Path $stateDir "$($service.Name).log"
  $errorLog = Join-Path $stateDir "$($service.Name).err.log"
  $command = "set `"T3CODE_HOME=$homeDir`"&& set `"T3CODE_TELEMETRY_ENABLED=false`"&& set `"T3CODE_OTEL_SDK_DISABLED=true`"&& `"$($service.File)`" $($service.Arguments -join ' ') > `"$log`" 2> `"$errorLog`""
  # Created through WMI so it inherits no handles and sits in no job of the terminal or agent that
  # ran this script: Start-Process children die with an agent's session and hold its output pipe open.
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /d /s /c `"$command`""
    CurrentDirectory = $service.Directory
    ProcessStartupInformation = $hidden
  }
  if ($created.ReturnValue -ne 0) { throw "$($service.Name) failed to start: $($created.ReturnValue)" }
  $process = Get-Process -Id $created.ProcessId
  $state[$service.Name] = @{
    Id = $process.Id
    StartedAt = $process.StartTime.ToUniversalTime().Ticks
  }
  $started += $service
  "{0}: starting" -f $service.Name
}
$state | ConvertTo-Json | Set-Content $statePath

foreach ($service in $started) {
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Port $service.Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  if (-not (Test-Port $service.Port)) {
    Write-Warning ("{0} didn't answer in time. See {1}" -f $service.Name, (Join-Path $stateDir "$($service.Name).err.log"))
  } elseif ($service.Name -ne "reflex") {
    "{0}: ready at http://localhost:{1}" -f $service.Name, $service.Port
  } elseif (Test-ReflexServed) {
    "reflex: ready at http://localhost:5734, serving the build in {0}" -f $dist
  } else {
    Write-Warning "reflex: port 5734 answers but doesn't serve $dist\index.html"
    $buildFailed = $true
  }
}
if (Test-Path $nextBuild) {
  Write-Warning "reflex: built, but something this script didn't start holds port 5734, so it still serves the old client"
  Remove-Item -Recurse -Force $nextBuild
  $buildFailed = $true
}
if ($Pause) { Read-Host "Press Enter to close" | Out-Null }
if ($buildFailed) { exit 1 }
