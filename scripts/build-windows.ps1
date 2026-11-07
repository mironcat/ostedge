param(
  [switch]$Portable,
  [switch]$Unpacked
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  if (-not (Test-Path 'node_modules')) {
    npm install
  }

  if ($Unpacked) {
    npm run pack
  } elseif ($Portable) {
    npm run dist:win:portable
  } else {
    npm run dist:win
  }

  if (-not $env:CSC_LINK -and -not $env:WIN_CSC_LINK) {
    Write-Host ''
    Write-Host 'Code signing is not configured: Windows SmartScreen may warn on first launch.' -ForegroundColor Yellow
    Write-Host 'Set CSC_LINK and CSC_KEY_PASSWORD to sign the build (see README).' -ForegroundColor Yellow
  }

  if (Test-Path 'release') {
    Write-Host ''
    Write-Host 'Artifacts in release:' -ForegroundColor Cyan
    Get-ChildItem 'release' -File |
      Select-Object Name, @{Name = 'MB'; Expression = { [math]::Round($_.Length / 1MB, 1) } }, LastWriteTime |
      Format-Table -AutoSize
  }
} finally {
  Pop-Location
}
