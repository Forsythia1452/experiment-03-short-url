$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:DEMO_MODE = 'true'
$env:WEB_PORT = '8501'
$env:DEMO_DB_PATH = Join-Path $projectRoot 'data\shortlinks.db'
Write-Host '本地演示模式：http://localhost:8501（Ctrl+C 停止）' -ForegroundColor Green
Push-Location $projectRoot
try { node web/server.js } finally { Pop-Location }

