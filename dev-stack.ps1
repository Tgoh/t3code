#!/usr/bin/env pwsh
#
#   ./dev-stack.ps1           start whatever isn't already running
#   ./dev-stack.ps1 -Status   show what's running
#   ./dev-stack.ps1 -Stop     stop what this script started
#   ./dev-stack.ps1 -Restart  stop, then start
#   ./dev-stack.ps1 -Restart -Only treflex   restart one service (server, treflex or stock)
#
# A service's optional hooks run before it is stopped (Prepare), between stop and start (Install), and
# once its port answers (Verify). A failing hook makes the run exit 1, and a failing Prepare skips the
# restart, so a running service keeps running as it was.
# The treflex client's hooks build it with apps/treflex-web/scripts/driver-build.ps1.
#
# Starting and stopping run elevated: an unelevated run reopens itself as administrator. The work
# runs in a detached copy whose output is printed when it ends and kept in
# t3code-dev-home/dev-stack/dev-stack.log, so a restart run by a T3 agent, which dies with the
# server, still finishes and leaves its output there.
[CmdletBinding()]
param(
  [switch]$Status,
  [switch]$Stop,
  [switch]$Restart,
  [ValidateSet("server", "treflex", "stock")]
  [string]$Only,
  [switch]$Pause,
  [switch]$Detached
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$homeDir = Join-Path (Split-Path $root -Parent) "t3code-dev-home"
$stateDir = Join-Path $homeDir "dev-stack"
$statePath = Join-Path $stateDir "processes.json"
$node = (Get-Command node).Source
$vp = (Get-Command vp).Source
$driverBuild = Join-Path $root "apps/treflex-web/scripts/driver-build.ps1"

$services = @(
  @{
    Name = "server"
    Port = 13773
    File = $node
    Arguments = @("src/bin.ts", "--port", "13773", "--base-dir", "`"$homeDir`"", "--no-browser")
    Directory = Join-Path $root "apps/server"
  },
  @{
    Name = "treflex"
    Port = 5734
    File = $vp
    Arguments = @("preview", "--port", "5734", "--strictPort")
    Directory = Join-Path $root "apps/treflex-web"
    Prepare = { & $driverBuild -Build -StateDir $stateDir }
    Install = { & $driverBuild -Install -StateDir $stateDir }
    Verify = { & $driverBuild -Verify -Port 5734 }
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
    # Windows PowerShell 5.1's parameterless TcpClient is IPv4-only, so it could never reach ::1.
    $client = [System.Net.Sockets.TcpClient]::new([System.Net.IPAddress]::Parse($address).AddressFamily)
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
  # A stack started before the client's rename holds it as "reflex"; the next stop rewrites the file.
  if ($held.ContainsKey("reflex") -and -not $held.ContainsKey("treflex")) {
    $held["treflex"] = $held["reflex"]
    $held.Remove("reflex")
  }
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

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$shell = (Get-Process -Id $PID).Path
$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Detached")
if ($Stop) { $arguments += "-Stop" }
if ($Restart) { $arguments += "-Restart" }
if ($Only) { $arguments += @("-Only", $Only) }

# A T3 agent runs inside the server's process tree and job, and Stop-Stack's taskkill would end
# this script with the server. A parent-chain check can't see that, since Git Bash leaves dead
# parent ids, so every run works in a copy WMI starts outside both, and waits for it.
if (-not $Status -and -not $Detached) {
  New-Item -ItemType Directory -Force $stateDir | Out-Null
  $log = Join-Path $stateDir "dev-stack.log"
  Remove-Item $log -ErrorAction SilentlyContinue
  $hidden = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /d /s /c `"`"$shell`" $($arguments -join ' ') > `"$log`" 2>&1`""
    CurrentDirectory = $root
    ProcessStartupInformation = $hidden
  }
  if ($created.ReturnValue -ne 0) { throw "Couldn't start the detached copy: $($created.ReturnValue)" }
  $copy = Get-Process -Id $created.ProcessId -ErrorAction SilentlyContinue
  if ($copy) {
    $null = $copy.Handle
    $copy.WaitForExit()
  }
  if (Test-Path $log) { Get-Content $log }
  if ($copy -and $copy.ExitCode -ne 0) { exit $copy.ExitCode }
  return
}
if (-not $Status -and -not $elevated) {
  Start-Process $shell -Verb RunAs -ArgumentList ($arguments + "-Pause")
  "Continuing in an administrator window."
  return
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

New-Item -ItemType Directory -Force $stateDir | Out-Null

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

$failed = $false
$prepared = @()
foreach ($service in @($services)) {
  if (-not $service.Prepare -or (-not $Restart -and (Test-Port $service.Port))) { continue }
  & $service.Prepare
  if ($LASTEXITCODE -eq 0) {
    $prepared += $service.Name
  } else {
    $failed = $true
    if ($Restart) { $services = @($services | Where-Object { $_.Name -ne $service.Name }) }
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
    if ($prepared -contains $service.Name) {
      Write-Warning ("{0}: something this script didn't start holds the port, so it still runs the old version" -f $service.Name)
      $failed = $true
    }
    continue
  }
  if ($service.Install) { & $service.Install }
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
    continue
  }
  "{0}: ready at http://localhost:{1}" -f $service.Name, $service.Port
  if ($service.Verify) {
    & $service.Verify
    if ($LASTEXITCODE -ne 0) { $failed = $true }
  }
}
if ($Pause) { Read-Host "Press Enter to close" | Out-Null }
if ($failed) { exit 1 }
