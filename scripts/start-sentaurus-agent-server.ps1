param(
  [string]$ServerRepository = $env:SENTAURUS_WEB_AGENT_REPO
)

$ErrorActionPreference = 'Stop'

if (-not $ServerRepository) {
  $ServerRepository = Join-Path (Split-Path $PSScriptRoot -Parent) '..\Sentaurus-agent'
}
$ServerRepository = (Resolve-Path -LiteralPath $ServerRepository).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logPath = Join-Path $ServerRepository '.ipv6-server.log'

Set-Location -LiteralPath $ServerRepository
& $npm run dev:server *>> $logPath
exit $LASTEXITCODE
