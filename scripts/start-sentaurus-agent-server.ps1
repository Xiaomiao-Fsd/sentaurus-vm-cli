param(
  [string]$ServerRepository = $env:SENTAURUS_WEB_AGENT_REPO,
  [switch]$IncludeWeb,
  [switch]$ServerOnly
)

$ErrorActionPreference = 'Stop'

if ($IncludeWeb -and $ServerOnly) {
  throw 'IncludeWeb and ServerOnly cannot be used together.'
}

if (-not $ServerRepository) {
  $ServerRepository = Join-Path (Split-Path $PSScriptRoot -Parent) '..\Sentaurus-agent'
}
$ServerRepository = (Resolve-Path -LiteralPath $ServerRepository).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logPath = Join-Path $ServerRepository '.ipv6-server.log'
$userIncludeWeb = [Environment]::GetEnvironmentVariable('SENTAURUS_AGENT_INCLUDE_WEB', 'User')
$startFullStack = -not $ServerOnly -and (
  $IncludeWeb -or $env:SENTAURUS_AGENT_INCLUDE_WEB -eq '1' -or $userIncludeWeb -eq '1'
)

Set-Location -LiteralPath $ServerRepository
if ($startFullStack) {
  Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
  & $npm run dev -- --kill-others-on-fail *>> $logPath
} else {
  & $npm run dev:server *>> $logPath
}
exit $LASTEXITCODE
