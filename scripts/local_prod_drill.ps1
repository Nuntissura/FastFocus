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

function Test-TcpPortAvailable([int]$Port) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

$repoRoot = Resolve-Path -Path (Join-Path -Path $PSScriptRoot -ChildPath "..")
$workspaceRoot = Find-WorkspaceRoot -startDir $repoRoot
$dbHostPort = $env:FF_PG_PORT
if (-not $dbHostPort) {
  foreach ($candidatePort in @(55434, 55435, 55432, 55436)) {
    if (Test-TcpPortAvailable -Port $candidatePort) {
      $dbHostPort = "$candidatePort"
      break
    }
  }
  if (-not $dbHostPort) {
    $dbHostPort = "55434"
  }
  $env:FF_PG_PORT = $dbHostPort
}
$activeCameraBrandsRaw = $env:FF_ACTIVE_CAMERA_BRANDS
if (-not $activeCameraBrandsRaw) { $activeCameraBrandsRaw = "sony,nikon,fujifilm,panasonic,olympus,om-system,canon" }
$syncActiveCameraBrandsRaw = $env:FF_SYNC_ACTIVE_CAMERA_BRANDS
if (-not $syncActiveCameraBrandsRaw) { $syncActiveCameraBrandsRaw = "1" }
$syncActiveCameraBrands = @("1", "true", "yes", "on") -contains $syncActiveCameraBrandsRaw.Trim().ToLowerInvariant()
$activeCameraBrands = @(
  $activeCameraBrandsRaw.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
)
$brandFixtures = @{
  "sony" = @{
    CameraPath = "/cameras/sony-a7-iv"
    ComparePath = "/compare/sony-a7-iv-vs-sony-a7-c-ii"
  }
  "nikon" = @{
    CameraPath = "/cameras/nikon-z8"
    ComparePath = "/compare/nikon-z8-vs-nikon-z6-iii"
  }
  "fujifilm" = @{
    CameraPath = "/cameras/fujifilm-x-s20"
    ComparePath = "/compare/fujifilm-x-s20-vs-fujifilm-x-h2"
  }
  "panasonic" = @{
    CameraPath = "/cameras/panasonic-lumix-s5-ii"
    ComparePath = "/compare/panasonic-lumix-s5-ii-vs-panasonic-lumix-s5"
  }
  "olympus" = @{
    CameraPath = "/cameras/olympus-om-d-e-m1-mark-iii"
    ComparePath = "/compare/olympus-om-d-e-m1-mark-iii-vs-olympus-om-d-e-m1-mark-ii"
  }
  "om-system" = @{
    CameraPath = "/cameras/om-system-om-1-mark-ii"
    ComparePath = "/compare/om-system-om-1-mark-ii-vs-om-system-om-1"
  }
  "canon" = @{
    CameraPath = "/cameras/canon-eos-r5"
    ComparePath = "/compare/canon-eos-r5-vs-canon-eos-r6"
  }
}

Push-Location $workspaceRoot
try {
  $imageTag = "fastfocus-platform:drill"
  $apiContainerName = "fastfocus_api_drill"
  $composeProjectDir = Join-Path -Path $workspaceRoot -ChildPath "FF - worktrees/fastfocus_platform"
  $composeFile = Join-Path -Path $composeProjectDir -ChildPath "docker-compose.yml"
  $dbUrl = "postgres://fastfocus:fastfocus@host.docker.internal:$dbHostPort/fastfocus"

  Write-Step "Build Docker image ($imageTag)"
  docker build -f "FF - worktrees/fastfocus_platform/Dockerfile" -t $imageTag .

  Write-Step "Start local Postgres (docker compose, host port $dbHostPort)"
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
  docker run --rm --add-host=host.docker.internal:host-gateway -e DATABASE_URL=$dbUrl $imageTag node apps/api/src/db/migrate.js

  if ($syncActiveCameraBrands) {
    Write-Step "Sync active camera brands (keep: $activeCameraBrandsRaw)"
    docker run --rm --add-host=host.docker.internal:host-gateway -e DATABASE_URL=$dbUrl $imageTag node apps/api/src/db/purge_camera_models.js --exclude-brands $activeCameraBrandsRaw --confirm
  }

  foreach ($brandSlug in $activeCameraBrands) {
    Write-Step "Import $brandSlug camera datasheets (inside image)"
    docker run --rm --add-host=host.docker.internal:host-gateway -e DATABASE_URL=$dbUrl $imageTag node apps/api/src/db/import_camera_datasheets.js --brand-slug $brandSlug --confirm
  }

  Write-Step "Start web service container (http://localhost:8787)"
  cmd /c "docker inspect $apiContainerName >nul 2>nul"
  if ($LASTEXITCODE -eq 0) {
    docker rm -f $apiContainerName | Out-Null
  }
  docker run -d --name $apiContainerName --add-host=host.docker.internal:host-gateway -p 8787:8787 `
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
  foreach ($brandSlug in $activeCameraBrands) {
    if (-not $brandFixtures.ContainsKey($brandSlug)) { continue }
    $fixture = $brandFixtures[$brandSlug]
    Assert-Http200 "http://localhost:8787$($fixture.CameraPath)"
    Assert-Http200 "http://localhost:8787$($fixture.ComparePath)"
  }
  Assert-Http200 "http://localhost:8787/api/v1/admin/ops/status" @{ "x-admin-token" = "drill-admin" }

  Write-Step "Done"
  Write-Host "Local drill completed successfully."
} finally {
  Write-Step "Cleanup"
  cmd /c "docker inspect $apiContainerName >nul 2>nul"
  if ($LASTEXITCODE -eq 0) {
    docker rm -f $apiContainerName | Out-Null
  }
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
