param(
  [switch]$StopDb
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Find-WorkspaceRoot([string]$startDir) {
  $cur = Resolve-Path -Path $startDir
  while ($true) {
    $gov = Join-Path -Path $cur -ChildPath "FF - gov"
    $worktrees = Join-Path -Path $cur -ChildPath "FF - worktrees"
    if ((Test-Path -LiteralPath $gov) -and (Test-Path -LiteralPath $worktrees)) {
      return $cur
    }
    $parent = Split-Path -Path $cur -Parent
    if (-not $parent -or $parent -eq $cur) {
      throw "Could not find workspace root containing 'FF - gov' and 'FF - worktrees' starting from: $startDir"
    }
    $cur = $parent
  }
}

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg"
}

$repoRoot = Resolve-Path -Path (Join-Path -Path $PSScriptRoot -ChildPath "..")
$workspaceRoot = Find-WorkspaceRoot -startDir $repoRoot

Push-Location $workspaceRoot
try {
  $imageTag = "fastfocus-platform:drill"
  $apiContainerName = "fastfocus_api_drill"
  $composeProjectDir = Join-Path -Path $workspaceRoot -ChildPath "FF - worktrees/fastfocus_platform"
  $composeFile = Join-Path -Path $composeProjectDir -ChildPath "docker-compose.yml"
  $networkName = "fastfocus_default"
  $dbUrl = "postgres://fastfocus:fastfocus@db:5432/fastfocus"

  Write-Step "Build Docker image ($imageTag)"
  docker build -f "FF - worktrees/fastfocus_platform/Dockerfile" -t $imageTag .

  Write-Step "Start local Postgres (docker compose)"
  Push-Location $composeProjectDir
  try {
    docker compose -f $composeFile up -d db
  } finally {
    Pop-Location
  }

  Write-Step "Wait for Postgres healthcheck"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Push-Location $composeProjectDir
      try {
        docker compose -f $composeFile exec -T db pg_isready -U fastfocus -d fastfocus | Out-Null
      } finally {
        Pop-Location
      }
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) { throw "Postgres did not become ready in time." }

  Write-Step "Run DB migrations (inside image)"
  docker run --rm --network $networkName -e DATABASE_URL=$dbUrl $imageTag node apps/api/src/db/migrate.js

  Write-Step "Import Canon camera datasheets (inside image)"
  docker run --rm --network $networkName -e DATABASE_URL=$dbUrl $imageTag node apps/api/src/db/import_camera_datasheets.js --brand-slug canon --confirm

  Write-Step "Start web service container (http://localhost:8787)"
  docker rm -f $apiContainerName 2>$null | Out-Null
  docker run -d --name $apiContainerName --network $networkName -p 8787:8787 `
    -e DATABASE_URL=$dbUrl `
    -e FF_ADMIN_TOKEN="drill-admin" `
    -e FF_PUBLIC_BASE_URL="http://localhost:8787" `
    $imageTag | Out-Null

  Write-Step "Verify endpoints"
  function Assert-Http200([string]$url, [hashtable]$headers = @{}) {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers
    if ($resp.StatusCode -ne 200) { throw "Expected 200 for $url, got $($resp.StatusCode)" }
    Write-Host "OK 200: $url"
  }

  # Wait for server start
  $serverUp = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Assert-Http200 "http://localhost:8787/health"
      $serverUp = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $serverUp) { throw "Web server did not become ready in time." }

  Assert-Http200 "http://localhost:8787/"
  Assert-Http200 "http://localhost:8787/cameras/canon-eos-r5"
  Assert-Http200 "http://localhost:8787/compare/canon-eos-r5-vs-canon-eos-r6"
  Assert-Http200 "http://localhost:8787/api/v1/admin/ops/status" @{ "x-admin-token" = "drill-admin" }

  Write-Step "Done"
  Write-Host "Local drill completed successfully."
} finally {
  Write-Step "Cleanup"
  docker rm -f "fastfocus_api_drill" 2>$null | Out-Null
  if ($StopDb) {
    $composeProjectDir = Join-Path -Path $workspaceRoot -ChildPath "FF - worktrees/fastfocus_platform"
    $composeFile = Join-Path -Path $composeProjectDir -ChildPath "docker-compose.yml"
    Push-Location $composeProjectDir
    try {
      docker compose -f $composeFile down | Out-Null
    } finally {
      Pop-Location
    }
    Write-Host "Stopped DB (StopDb=1)."
  } else {
    Write-Host "Left DB running (pass -StopDb to stop it)."
  }
  Pop-Location
}
