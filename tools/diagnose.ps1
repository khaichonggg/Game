# Bumper Brawl diagnostics (called by diagnose.bat). Collects what is needed to figure out
# "cannot connect" problems and writes diagnose-report.txt next to start.bat.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files in the system code page).
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$out = New-Object System.Collections.Generic.List[string]
function Say([string]$s) { $out.Add($s); Write-Host $s }
function Section([string]$title) { Say ''; Say ('== ' + $title + ' ==') }
function Try-Run([scriptblock]$b) {
  try { & $b } catch { Say ('  (not available: ' + $_.Exception.Message + ')') }
}

Say ('Bumper Brawl diagnostics  ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ('Folder: ' + $Root)

Section 'Game'
Try-Run {
  $pkg = Get-Content -Raw -Path (Join-Path $Root 'package.json') | ConvertFrom-Json
  Say ('  version: ' + $pkg.version)
}
Try-Run { Say ('  OS: ' + [Environment]::OSVersion.VersionString + '  64-bit: ' + [Environment]::Is64BitOperatingSystem) }

Section 'Node.js'
$bundled = Join-Path $Root 'runtime\node.exe'
Say ('  runtime\node.exe present: ' + (Test-Path $bundled))
Try-Run {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if ($n) { Say ('  node on PATH: ' + $n.Source + '  ' + (& node -v)) } else { Say '  node on PATH: no' }
}

Section 'Running game servers'
$pids = @()
Try-Run {
  $procs = Get-Process -Name node -ErrorAction SilentlyContinue
  if (-not $procs) { Say '  no node.exe process is running  ->  the server is NOT running (double-click start.bat)' }
  foreach ($p in $procs) {
    $pids += $p.Id
    Say ('  node.exe pid ' + $p.Id + '  started ' + $p.StartTime + '  ' + $p.Path)
  }
}
Try-Run {
  $listen = Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $pids -contains $_.OwningProcess }
  if ($listen) { foreach ($l in $listen) { Say ('  listening on ' + $l.LocalAddress + ':' + $l.LocalPort + '  (pid ' + $l.OwningProcess + ')') } }
  elseif ($pids.Count) { Say '  node is running but not listening on any port' }
}

Section 'Server response'
$found = $false
foreach ($port in 3000..3010) {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $port + "/api/info") -TimeoutSec 3 -UseBasicParsing
    Say ('  port ' + $port + ': OK  ' + $r.Content)
    $found = $true
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match 'timed out|timeout') { Say ('  port ' + $port + ': NO ANSWER (timed out) - server may be paused: press Esc in the black window') }
  }
}
if (-not $found) { Say '  no game server answered on ports 3000-3010' }

Section 'Console'
Try-Run {
  $qe = (Get-ItemProperty -Path 'HKCU:\Console' -Name QuickEdit -ErrorAction SilentlyContinue).QuickEdit
  Say ('  QuickEdit default (1 = clicking the window pauses programs): ' + $qe)
}

Section 'Network'
Try-Run {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object {
    Say ('  ' + $_.InterfaceAlias + ': ' + $_.IPAddress)
  }
}
Try-Run {
  Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object {
    Say ('  network "' + $_.Name + '" on ' + $_.InterfaceAlias + ': ' + $_.NetworkCategory + $(if ($_.NetworkCategory -eq 'Public') { '  <- friends may be blocked; set it to Private' } else { '' }))
  }
}

Section 'Firewall'
Try-Run {
  Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { Say ('  ' + $_.Name + ' profile enabled: ' + $_.Enabled) }
}
Try-Run {
  $rules = Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object { $_.Program -like '*node.exe' } | Get-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not $rules) { Say '  no firewall rule for node.exe yet (Windows asks the first time the server starts)' }
  foreach ($r in $rules) { Say ('  rule "' + $r.DisplayName + '": ' + $r.Direction + ' ' + $r.Action + ' profiles=' + $r.Profile + ' enabled=' + $r.Enabled) }
}

Section 'Last errors (data\crash.log)'
$log = Join-Path $Root 'data\crash.log'
if (Test-Path $log) { Get-Content -Path $log -Tail 40 | ForEach-Object { Say ('  ' + $_) } } else { Say '  no crash.log (no server errors recorded)' }

$report = Join-Path $Root 'diagnose-report.txt'
$out | Set-Content -Path $report -Encoding UTF8
Try-Run { Set-Clipboard -Value ($out -join [Environment]::NewLine) }
Say ''
Say ('Saved to ' + $report + ' (also copied to the clipboard)')
