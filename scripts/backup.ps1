$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $projectRoot 'backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $backupDir "shlink-$stamp.sql"

Push-Location $projectRoot
try {
    $running = docker compose ps --status running --services
    if ($running -notcontains 'db') { throw '数据库容器未运行，无法备份。' }
    docker compose exec -T db pg_dump -U shlink -d shlink --clean --if-exists | Set-Content -LiteralPath $target -Encoding utf8
    Write-Host "备份完成：$target" -ForegroundColor Green
} finally { Pop-Location }

