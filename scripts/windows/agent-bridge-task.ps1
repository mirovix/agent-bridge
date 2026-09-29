# Registers (or removes) Agent Bridge as a per-user Scheduled Task that starts
# at logon with no visible window. Called by scripts/install-service.js:
#   npm run service:install / npm run service:uninstall
param(
  [Parameter(Mandatory = $true)] [ValidateSet('Install', 'Uninstall')] [string] $Action,
  [string] $ProjectRoot,
  [string] $NodePath,
  [string] $TaskName = 'AgentBridge'
)
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($Action -eq 'Uninstall') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Scheduled task '$TaskName' removed."
  } else {
    Write-Output "Scheduled task '$TaskName' is not installed."
  }
  exit 0
}

if (-not $ProjectRoot -or -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'src\server.js'))) {
  throw "ProjectRoot must be the Agent Bridge folder (src\server.js not found in '$ProjectRoot')."
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { throw "Node.js not found at '$NodePath'." }

# A hidden powershell.exe owns the console and node.exe inherits it, so no window
# stays open; the task keeps running as long as the server does (restart on failure).
$node = $NodePath.Replace("'", "''")
$command = "& '$node' 'src\server.js'; exit `$LASTEXITCODE"
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$command`"" `
  -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Description 'Agent Bridge (remote console for Claude Code / Codex)' `
  -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Scheduled task '$TaskName' registered for $user and started."
