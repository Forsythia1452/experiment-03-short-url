$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    docker compose down
    Write-Host '容器已停止，命名卷和业务数据已保留。' -ForegroundColor Green
    Write-Host '不要在正常验收时执行 docker compose down -v。' -ForegroundColor Yellow
} finally { Pop-Location }

