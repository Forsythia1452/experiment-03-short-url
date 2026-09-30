param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolved = (Resolve-Path -LiteralPath $BackupFile).Path
if ([IO.Path]::GetExtension($resolved) -ne '.sql') { throw '仅允许恢复 .sql 备份文件。' }

Write-Host '警告：恢复会覆盖当前 Shlink 数据库内容。' -ForegroundColor Yellow
$answer = Read-Host '请输入 RESTORE 继续'
if ($answer -cne 'RESTORE') { Write-Host '已取消。'; exit 1 }

Push-Location $projectRoot
try {
    Get-Content -LiteralPath $resolved -Raw | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U shlink -d shlink
    Write-Host '恢复完成。' -ForegroundColor Green
} finally { Pop-Location }

