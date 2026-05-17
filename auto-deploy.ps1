# auto-deploy.ps1
# Polls GitHub every 5 minutes (via Scheduled Task) and rebuilds the
# Docker stack if there are new commits on main.
#
# One-time setup (run as Administrator in the repo directory):
#
#   $dir = (Get-Location).Path
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument "-NonInteractive -File `"$dir\auto-deploy.ps1`"" `
#     -WorkingDirectory $dir
#   $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
#   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
#   Register-ScheduledTask -TaskName "MoneyTalks AutoDeploy" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
#
# To remove the task later:
#   Unregister-ScheduledTask -TaskName "MoneyTalks AutoDeploy" -Confirm:$false

$ErrorActionPreference = "Stop"
$logFile = Join-Path $PSScriptRoot "deploy.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $logFile -Value $line
}

Set-Location $PSScriptRoot

# Trim log to last 500 lines so it doesn't grow forever
if (Test-Path $logFile) {
    $lines = Get-Content $logFile
    if ($lines.Count -gt 500) {
        $lines | Select-Object -Last 500 | Set-Content $logFile
    }
}

try {
    git fetch origin main 2>&1 | Out-Null

    $local  = git rev-parse HEAD
    $remote = git rev-parse origin/main

    if ($local -eq $remote) {
        exit 0   # nothing to do — skip silently
    }

    Log "New commit detected ($($remote.Substring(0,7))). Deploying..."

    git pull origin main 2>&1 | ForEach-Object { Log $_ }
    docker compose up -d --build 2>&1 | ForEach-Object { Log $_ }

    Log "Deploy complete."
} catch {
    Log "ERROR: $_"
    exit 1
}
