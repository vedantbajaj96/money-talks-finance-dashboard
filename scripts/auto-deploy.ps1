# scripts/auto-deploy.ps1
# Polls GitHub every 5 minutes (via Scheduled Task) and rebuilds the
# Docker stack if there are new commits on main.
#
# One-time setup (run as Administrator in the repo root):
#
#   $script = Join-Path (Get-Location).Path "scripts\auto-deploy.ps1"
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument "-NonInteractive -File `"$script`""
#   $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
#   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
#   Register-ScheduledTask -TaskName "MoneyTalks AutoDeploy" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
#
# To remove the task later:
#   Unregister-ScheduledTask -TaskName "MoneyTalks AutoDeploy" -Confirm:$false

$ErrorActionPreference = "Stop"

# Script lives in scripts/ — git and docker must run from the repo root
$repoRoot = Split-Path $PSScriptRoot
$logFile  = Join-Path $repoRoot "deploy.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $logFile -Value $line
}

Set-Location $repoRoot

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
