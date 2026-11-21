$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  npm run build:web
  if ($LASTEXITCODE -ne 0) { throw 'build:web failed' }
  npm run build:admin
  if ($LASTEXITCODE -ne 0) { throw 'build:admin failed' }
  npm run build:headless
  if ($LASTEXITCODE -ne 0) { throw 'build:headless failed' }

  $nodeExe = (Get-Command node).Source
  Copy-Item $nodeExe (Join-Path $root 'node.exe') -Force

  $winsw = Join-Path $PSScriptRoot 'winsw\CloudBoxService.exe'
  if (-not (Test-Path $winsw)) {
    throw "Missing WinSW binary: $winsw"
  }

  $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($null -eq $iscc) {
    $iscc = Get-ChildItem 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' -ErrorAction SilentlyContinue
    if ($null -eq $iscc) { $iscc = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe') -ErrorAction SilentlyContinue }
  }
  if ($null -eq $iscc) { throw 'Inno Setup 6 ISCC.exe not found' }

  $compiler = if ($iscc.Source) { $iscc.Source } else { $iscc.FullName }
  & $compiler (Join-Path $PSScriptRoot 'inno\CloudBox.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compile failed' }
} finally {
  Pop-Location
}
