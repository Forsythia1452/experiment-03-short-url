$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envFile
    Write-Host '已创建 .env，请先替换两个“请替换”占位值，再重新运行。' -ForegroundColor Yellow
    exit 1
}

$raw = Get-Content -LiteralPath $envFile -Raw
if ($raw -match '请替换') {
    Write-Host '.env 仍包含占位值，请设置 POSTGRES_PASSWORD 和 INITIAL_API_KEY。' -ForegroundColor Yellow
    exit 1
}

Push-Location $projectRoot
try {
    docker compose config --quiet
    docker compose up -d --build
    docker compose ps
    Write-Host '管理页面：http://localhost:8501' -ForegroundColor Green
    Write-Host 'Shlink 跳转入口：http://localhost:8080' -ForegroundColor Green
} finally { Pop-Location }

