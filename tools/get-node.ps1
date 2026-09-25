# Downloads portable Node.js for Windows into the given folder (called by start.bat on first run).
# Tries the official site first, then the npmmirror mirror (faster in China). The file is checked
# against the official SHA-256 before it is used. Keep this file ASCII-only: Windows PowerShell 5.1
# reads BOM-less files in the system code page.
param([Parameter(Mandatory = $true)][string]$Dest)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the progress bar makes downloads very slow in PowerShell 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$ver = 'v24.21.0'
$hashes = @{
  'x64'   = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
  'arm64' = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'
}
$cpu = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $cpu = $env:PROCESSOR_ARCHITEW6432 }
if ($cpu -eq 'ARM64') { $arch = 'arm64' } elseif ($cpu -eq 'AMD64') { $arch = 'x64' } else {
  Write-Host "  This CPU ($cpu) needs Node.js installed from https://nodejs.org/"
  exit 1
}

$name = "node-$ver-win-$arch"
$zip = Join-Path $env:TEMP "$name.zip"
$urls = @(
  "https://nodejs.org/dist/$ver/$name.zip",
  "https://cdn.npmmirror.com/binaries/node/$ver/$name.zip",
  "https://npmmirror.com/mirrors/node/$ver/$name.zip"
)
$ok = $false
foreach ($u in $urls) {
  try {
    Write-Host "  -> $u"
    Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 600
    $h = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
    if ($h -eq $hashes[$arch]) { $ok = $true; break }
    Write-Host '     checksum mismatch, trying the next mirror'
  } catch {
    Write-Host ('     failed: ' + $_.Exception.Message)
  }
}
if (-not $ok) {
  if (Test-Path $zip) { Remove-Item $zip -Force }
  exit 1
}

$tmp = Join-Path $env:TEMP ('bb-node-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -Path $zip -DestinationPath $tmp -Force
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$src = Join-Path $tmp $name
Copy-Item -Path (Join-Path $src 'node.exe') -Destination (Join-Path $Dest 'node.exe') -Force
Copy-Item -Path (Join-Path $src 'LICENSE') -Destination (Join-Path $Dest 'LICENSE') -Force
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force
Write-Host '  OK'
exit 0
