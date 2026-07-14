#Requires -RunAsAdministrator

param(
  [string]$TaskName = 'Sentaurus VM Agent IPv6 API',
  [int]$Port = 5175,
  [string]$ServerRepository = $env:SENTAURUS_WEB_AGENT_REPO,
  [switch]$PublicApi
)

$ErrorActionPreference = 'Stop'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcher = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start-sentaurus-agent-server.ps1')).Path
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
if ($ServerRepository) {
  $resolvedRepository = (Resolve-Path -LiteralPath $ServerRepository).Path
  $arguments += " -ServerRepository `"$resolvedRepository`""
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

$firewallName = "Sentaurus VM Agent API $Port"
$firewallRule = Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
if ($PublicApi -and -not $firewallRule) {
  $firewallRule = New-NetFirewallRule `
    -DisplayName $firewallName `
    -Description 'Allow authenticated Sentaurus VM Agent API over host IPv6.' `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Public,Private `
    -EdgeTraversalPolicy Allow
} elseif ($PublicApi) {
  $firewallRule | Set-NetFirewallRule -Enabled True -Profile Public,Private -Action Allow -EdgeTraversalPolicy Allow
  $firewallRule | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program Any
} elseif ($firewallRule) {
  $firewallRule | Disable-NetFirewallRule
}

Start-ScheduledTask -TaskName $TaskName
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
