param(
  [string]$GuiPaths = '',
  [string]$ServerPaths = '',
  [string]$DefaultAppData = '',
  [string]$DefaultProgramData = '',
  [string]$AppRoot = '',
  [switch]$DeleteDefaults
)

$ErrorActionPreference = 'SilentlyContinue'

function Normalize-Path([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  try {
    $full = [System.IO.Path]::GetFullPath($value.Trim())
    return $full.TrimEnd('\', '/')
  } catch {
    return $null
  }
}

function Is-SameOrChild([string]$child, [string]$parent) {
  if ($null -eq $child -or $null -eq $parent) { return $false }
  $c = $child.TrimEnd('\', '/').ToLowerInvariant()
  $p = $parent.TrimEnd('\', '/').ToLowerInvariant()
  return $c -eq $p -or $c.StartsWith($p + '\')
}

$protected = @()
foreach ($value in @(
  $env:WINDIR,
  $env:ProgramFiles,
  ${env:ProgramFiles(x86)},
  $env:ProgramData,
  $env:APPDATA,
  $env:LOCALAPPDATA,
  $env:USERPROFILE
)) {
  $normalized = Normalize-Path $value
  if ($normalized) { $protected += $normalized }
}
$appRoot = Normalize-Path $AppRoot
if ($appRoot) { $protected += $appRoot }

$candidates = New-Object System.Collections.Generic.List[string]
foreach ($file in @($GuiPaths, $ServerPaths)) {
  if ([string]::IsNullOrWhiteSpace($file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  try {
    $json = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($name in @('dataDir', 'storageDir', 'pluginsDir')) {
      $value = $json.$name
      if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) {
        $candidates.Add($value) | Out-Null
      }
    }
  } catch {
    Write-Output "skip invalid path file: $file"
  }
}

if ($DeleteDefaults) {
  if ($DefaultAppData) { $candidates.Add($DefaultAppData) | Out-Null }
  if ($DefaultProgramData) { $candidates.Add($DefaultProgramData) | Out-Null }
}

$seen = @{}
foreach ($candidate in $candidates) {
  $target = Normalize-Path $candidate
  if ($null -eq $target -or $seen.ContainsKey($target.ToLowerInvariant())) { continue }
  $seen[$target.ToLowerInvariant()] = $true

  if ($target -match '^[A-Za-z]:$' -or $target.Length -lt 4) {
    Write-Output "refuse unsafe path: $target"
    continue
  }

  $unsafe = $false
  foreach ($root in $protected) {
    if (Is-SameOrChild $root $target) {
      $unsafe = $true
      break
    }
  }
  if ($unsafe) {
    Write-Output "refuse protected/ancestor path: $target"
    continue
  }

  if (-not (Test-Path -LiteralPath $target)) { continue }
  try {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    Write-Output "removed: $target"
  } catch {
    Write-Output "failed: $target ($($_.Exception.Message))"
  }
}
