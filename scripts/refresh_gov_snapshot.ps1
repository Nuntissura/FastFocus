$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$defaultWorkspaceRoot = (Resolve-Path (Join-Path $repoRoot "..\..")).Path
$workspaceRoot = if ($env:FF_WORKSPACE_ROOT -and $env:FF_WORKSPACE_ROOT.Trim()) {
  (Resolve-Path $env:FF_WORKSPACE_ROOT).Path
} else {
  $defaultWorkspaceRoot
}

$govRoot = Join-Path $workspaceRoot "FF - gov"
$snapshotRoot = Join-Path $repoRoot "gov-snapshot"

if (-not (Test-Path $govRoot)) {
  throw "Missing governance root: $govRoot"
}

if (Test-Path $snapshotRoot) {
  Remove-Item $snapshotRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $snapshotRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $snapshotRoot "workflow\templates") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $snapshotRoot "catalog") -Force | Out-Null

Copy-Item (Join-Path $govRoot "SPEC_CURRENT.md") $snapshotRoot
Copy-Item (Join-Path $govRoot "data_contracts") (Join-Path $snapshotRoot "data_contracts") -Recurse
Copy-Item (Join-Path $govRoot "workflow\templates\digital_camera_datasheet.v5.yaml") (Join-Path $snapshotRoot "workflow\templates\digital_camera_datasheet.v5.yaml")
Copy-Item (Join-Path $govRoot "catalog\data_sheets") (Join-Path $snapshotRoot "catalog\data_sheets") -Recurse

Write-Host "Refreshed gov-snapshot from $govRoot"
