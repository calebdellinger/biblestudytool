<#
  Margin: set up your PC as the server.
  Run in PowerShell as Administrator:   powershell -ExecutionPolicy Bypass -File .\install.ps1
  Safe to run again at any time; it skips whatever is already done.
#>
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Server = $PSScriptRoot
$Root = Split-Path -Parent $Server
$Config = Join-Path $Server 'config.json'

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host "Please run this in PowerShell opened with 'Run as administrator'." -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. Node.js
Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn "Installing Node.js LTS with winget..."
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-Path
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Write-Host "Node.js didn't install. Install it from https://nodejs.org and run this again." -ForegroundColor Red; exit 1 }
}
Ok "Node $(node --version) at $($node.Source)"

# ---------------------------------------------------------------- 2. Tailscale
Step "Tailscale"
$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) { $ts = Get-Item 'C:\Program Files\Tailscale\tailscale.exe' }
if (-not $ts) {
  Warn "Installing Tailscale with winget..."
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-Path
  if (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { $ts = Get-Item 'C:\Program Files\Tailscale\tailscale.exe' }
}
if (-not $ts) { Write-Host "Install Tailscale from https://tailscale.com/download and run this again." -ForegroundColor Red; exit 1 }
$tsExe = if ($ts.Source) { $ts.Source } else { $ts.FullName }
$tsStatus = $null
try { $tsStatus = & $tsExe status --json | ConvertFrom-Json } catch {}
if (-not $tsStatus -or $tsStatus.BackendState -ne 'Running') {
  Write-Host "   Tailscale is installed but not signed in. Open Tailscale from the system tray, sign in, then run this again." -ForegroundColor Yellow
  exit 1
}
$dns = $tsStatus.Self.DNSName.TrimEnd('.')
Ok "Signed in as this PC: $dns"

# ---------------------------------------------------------------- 3. CouchDB
Step "CouchDB"
$couchUp = $false
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5984/' -TimeoutSec 3 | Out-Null; $couchUp = $true }
catch { if ($_.Exception.Response) { $couchUp = $true } }  # 401 still means it's running
if (-not $couchUp) {
  Write-Host @"
   CouchDB isn't running yet. Install it once by hand (about 2 minutes):
     1. Download the Windows installer from https://couchdb.apache.org/#download
     2. Run it. Choose "Single node", and create an admin username and password. Remember them.
     3. Leave everything else as it is, finish, then run this script again.
"@ -ForegroundColor Yellow
  Start-Process 'https://couchdb.apache.org/#download'
  exit 1
}
Ok "CouchDB is running on this PC"

# ---------------------------------------------------------------- 4. Settings
Step "Settings"
if (Test-Path $Config) {
  $cfg = Get-Content $Config -Raw | ConvertFrom-Json
  Ok "Using existing settings in server\config.json"
} else {
  $user = Read-Host "   CouchDB admin username"
  $pass = Plain (Read-Host "   CouchDB admin password" -AsSecureString)

  Write-Host ""
  Write-Host "   Drives on this PC:"
  Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null } | ForEach-Object {
    $total = [math]::Round(($_.Used + $_.Free) / 1TB, 1)
    Write-Host ("     {0}:  {1} TB total, {2} TB free  {3}" -f $_.Name, $total, [math]::Round($_.Free/1TB,1), $_.Description)
  }
  $backupDir = Read-Host "   Folder for nightly backups on your backup drive (for example E:\MarginBackups)"

  $gd = @('G:\My Drive', "$env:USERPROFILE\My Drive", "$env:USERPROFILE\Google Drive") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($gd) { $suggest = Join-Path $gd 'Margin Backups' } else { $suggest = '' }
  $offsite = Read-Host "   Folder inside Google Drive for the weekly encrypted copy [$suggest]"
  if (-not $offsite) { $offsite = $suggest }
  if (-not $offsite) { Warn "No Google Drive folder found. Install Google Drive for desktop later and edit offsiteDir in server\config.json." }

  do {
    $bp1 = Plain (Read-Host "   Choose a password for the encrypted copy (store it somewhere safe; it can't be recovered)" -AsSecureString)
    $bp2 = Plain (Read-Host "   Type it again" -AsSecureString)
    if ($bp1 -ne $bp2) { Warn "Those didn't match. Try again." }
  } while ($bp1 -ne $bp2 -or -not $bp1)

  $cfg = [ordered]@{
    couchUser = $user; couchPassword = $pass; couchUrl = 'http://127.0.0.1:5984'; database = 'margin'
    port = 8787; httpsPort = 8443; backupDir = $backupDir; offsiteDir = $offsite; offsitePassword = $bp1
  }
  $cfg | ConvertTo-Json | Set-Content -Path $Config -Encoding UTF8
  # Only your Windows account can read this file (it holds passwords).
  icacls $Config /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  $cfg = Get-Content $Config -Raw | ConvertFrom-Json
  Ok "Saved server\config.json (readable only by $env:USERNAME)"
}

# Make sure Margin's port isn't taken by another program (for example a remote desktop host on 8080).
if (-not $cfg.httpsPort) { $cfg | Add-Member -NotePropertyName httpsPort -NotePropertyValue 8443 -Force }
function Port-Owner($port) {
  $l = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $l) { return $null }
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)").CommandLine
  if ($cmd -like '*server.mjs*') { return $null }  # that's Margin itself
  return (Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).ProcessName
}
$owner = Port-Owner $cfg.port
if ($owner) {
  $old = $cfg.port
  $new = 8787; while (Port-Owner $new) { $new++ }
  $cfg.port = $new
  Warn "Port $old is used by '$owner', so Margin will use port $new instead."
}
$cfg | ConvertTo-Json | Set-Content -Path $Config -Encoding UTF8

# ---------------------------------------------------------------- 5. Configure CouchDB
Step "Locking down CouchDB and creating the database"
Push-Location $Server
node setup-couch.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location
$svc = Get-Service | Where-Object { $_.Name -like '*couch*' -or $_.DisplayName -like '*CouchDB*' } | Select-Object -First 1
if ($svc) { Restart-Service $svc.Name; Start-Sleep 4; Ok "Restarted $($svc.DisplayName) so it only listens on this PC" }
else { Warn "Couldn't find the CouchDB service to restart. Restart your PC once so the new settings apply." }

# ---------------------------------------------------------------- 6. Scheduled tasks
Step "Background tasks"
$nodeExe = (Get-Command node).Source
$vbs = Join-Path $Server 'run-hidden.vbs'
function Add-MarginTask($name, $script, $args2, $trigger) {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`" `"$nodeExe`" `"$(Join-Path $Server $script)`" $args2" -WorkingDirectory $Server
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $name -TaskPath '\Margin\' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Ok "$name"
}
Add-MarginTask 'Margin server' 'server.mjs' '' (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME")
Add-MarginTask 'Margin nightly backup' 'backup.mjs' '' (New-ScheduledTaskTrigger -Daily -At 2:30am)
Add-MarginTask 'Margin weekly offsite backup' 'backup.mjs' '--offsite' (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3:00am)

Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskPath '\Margin\' -TaskName 'Margin server'
Start-Sleep 2
try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$($cfg.port)/" -TimeoutSec 5 | Out-Null; Ok "Margin is running on http://127.0.0.1:$($cfg.port)" }
catch { Warn "The Margin server didn't answer. Check that app\dist exists, then run: node server\server.mjs" }

# ---------------------------------------------------------------- 7. Tailscale HTTPS
Step "Sharing Margin with your devices over Tailscale"
# Margin gets its own HTTPS port so it never replaces anything else you serve with Tailscale.
& $tsExe serve --bg "--https=$($cfg.httpsPort)" "http://127.0.0.1:$($cfg.port)"
if ($LASTEXITCODE -ne 0) {
  Warn "Tailscale needs HTTPS turned on for your network first."
  Warn "Open https://login.tailscale.com/admin/dns, turn on MagicDNS and HTTPS Certificates, then run this again."
  exit 1
}
$appUrl = "https://$($dns):$($cfg.httpsPort)/"
Ok "$appUrl is live for your devices only"

# ---------------------------------------------------------------- 8. First backup
Step "First backup"
Push-Location $Server
node backup.mjs
if ($cfg.offsiteDir) { node backup.mjs --offsite }
Pop-Location

Write-Host ""
Write-Host "All set." -ForegroundColor Green
Write-Host "On each phone, tablet or computer:"
Write-Host "  1. Install Tailscale and sign in with the same account."
Write-Host "  2. Open $appUrl and add it to your home screen (Share, then Add to Home Screen)."
Write-Host "  3. In Margin, open Settings, enter username '$($cfg.couchUser)' and your CouchDB password, then Turn on sync."
