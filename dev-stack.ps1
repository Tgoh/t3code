#!/usr/bin/env pwsh
#
#   ./dev-stack.ps1           start whatever isn't already running
#   ./dev-stack.ps1 -Status   show what's running
#   ./dev-stack.ps1 -Stop     stop what this script started
#   ./dev-stack.ps1 -Restart  stop, then start
#
# Starting and stopping run elevated: an unelevated run reopens itself as administrator.
[CmdletBinding()]
param(
  [switch]$Status,
  [switch]$Stop,
  [switch]$Restart,
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $Status -and -not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Pause")
  if ($Stop) { $arguments += "-Stop" }
  if ($Restart) { $arguments += "-Restart" }
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
    Arguments = @("run", "dev")
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
  if (Test-Path $statePath) { Remove-Item $statePath }
}

if ($Stop) {
  Stop-Stack
  if ($Pause) { Read-Host "Press Enter to close" | Out-Null }
  return
}

if ($Restart) {
  Stop-Stack
  foreach ($service in $services) {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Test-Port $service.Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  }
}

New-Item -ItemType Directory -Force $stateDir | Out-Null
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
  if (Test-Port $service.Port) {
    "{0}: ready at http://localhost:{1}" -f $service.Name, $service.Port
  } else {
    Write-Warning ("{0} didn't answer in time. See {1}" -f $service.Name, (Join-Path $stateDir "$($service.Name).err.log"))
  }
}
if ($Pause) { Read-Host "Press Enter to close" | Out-Null }
