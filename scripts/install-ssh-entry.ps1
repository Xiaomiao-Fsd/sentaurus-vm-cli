#Requires -RunAsAdministrator

param(
  [string]$SshdConfig = 'C:\ProgramData\ssh\sshd_config'
)

$ErrorActionPreference = 'Stop'
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$openSshRegistry = 'HKLM:\SOFTWARE\OpenSSH'
$authorizedKeysLine = '       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys .ssh/authorized_keys'

if (-not (Test-Path -LiteralPath $powerShell)) {
  throw "PowerShell executable was not found: $powerShell"
}
if (-not (Test-Path -LiteralPath $SshdConfig)) {
  throw "sshd_config was not found: $SshdConfig"
}

New-Item -Path $openSshRegistry -Force | Out-Null
Set-ItemProperty -Path $openSshRegistry -Name DefaultShell -Value $powerShell -Type String
Set-ItemProperty -Path $openSshRegistry -Name DefaultShellCommandOption -Value '-c' -Type String

$content = [IO.File]::ReadAllText($SshdConfig)
$updated = [regex]::Replace(
  $content,
  '(?m)^\s*AuthorizedKeysFile\s+__PROGRAMDATA__/ssh/administrators_authorized_keys\s*$',
  $authorizedKeysLine
)
if ($updated -ne $content) {
  $backup = "$SshdConfig.sentaurus-vm-cli.bak"
  if (-not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $SshdConfig -Destination $backup
  }
  [IO.File]::WriteAllText($SshdConfig, $updated, [Text.UTF8Encoding]::new($false))
}

$sshd = (Get-Command sshd.exe -ErrorAction Stop).Source
& $sshd -t -f $SshdConfig
if ($LASTEXITCODE -ne 0) {
  throw 'OpenSSH rejected the updated sshd_config'
}

Restart-Service sshd
Get-ItemProperty -Path $openSshRegistry | Select-Object DefaultShell,DefaultShellCommandOption
Get-Service sshd | Select-Object Status,StartType
