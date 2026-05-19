# deploy.ps1 — One-command deploy for MoneyTalks on Windows
# Usage: .\deploy.ps1
#        .\deploy.ps1 -Full        # force full Plaid re-sync after deploy
#        .\deploy.ps1 -Model llama3.2   # override Ollama model (default: llama3.2)

param(
    [switch]$Full,
    [string]$Model = "llama3.2"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# 1. Check Docker is running
# ---------------------------------------------------------------------------
Write-Step "Checking Docker Desktop"
try {
    docker info 2>&1 | Out-Null
    Write-Ok "Docker is running"
} catch {
    Write-Fail "Docker Desktop is not running. Start it and try again."
}

# ---------------------------------------------------------------------------
# 2. Pull latest code
# ---------------------------------------------------------------------------
Write-Step "Pulling latest code"
git pull
if ($LASTEXITCODE -ne 0) { Write-Fail "git pull failed" }
Write-Ok "Code up to date"

# ---------------------------------------------------------------------------
# 3. Build and start containers
# ---------------------------------------------------------------------------
Write-Step "Building and starting containers"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Fail "docker compose up failed" }
Write-Ok "Containers started"

# ---------------------------------------------------------------------------
# 4. Wait for Ollama to be ready
# ---------------------------------------------------------------------------
Write-Step "Waiting for Ollama to be ready"
$attempts = 0
$maxAttempts = 30
while ($attempts -lt $maxAttempts) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:11434" -TimeoutSec 2 -ErrorAction Stop
        Write-Ok "Ollama is ready"
        break
    } catch {
        $attempts++
        if ($attempts -eq $maxAttempts) {
            Write-Warn "Ollama didn't respond after 60s — it may still be starting. Check: docker compose logs ollama"
        } else {
            Write-Host "    Waiting... ($attempts/$maxAttempts)" -ForegroundColor DarkGray
            Start-Sleep -Seconds 2
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Pull Ollama model if not already present
# ---------------------------------------------------------------------------
Write-Step "Checking Ollama model ($Model)"
$modelList = docker compose exec ollama ollama list 2>&1
if ($modelList -match $Model) {
    Write-Ok "Model '$Model' already present"
} else {
    Write-Host "    Pulling '$Model' — this may take a few minutes on first run..." -ForegroundColor DarkGray
    docker compose exec ollama ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Write-Warn "Model pull failed — you can retry with: docker compose exec ollama ollama pull $Model" }
    else { Write-Ok "Model '$Model' ready" }
}

# ---------------------------------------------------------------------------
# 6. Wait for app to be ready
# ---------------------------------------------------------------------------
Write-Step "Waiting for app to be ready"
$attempts = 0
while ($attempts -lt 20) {
    try {
        Invoke-WebRequest -Uri "http://localhost:8502" -TimeoutSec 2 -ErrorAction Stop | Out-Null
        Write-Ok "App is up"
        break
    } catch {
        $attempts++
        if ($attempts -eq 20) {
            Write-Warn "App didn't respond — check logs: docker compose logs moneytalks"
        } else {
            Start-Sleep -Seconds 3
        }
    }
}

# ---------------------------------------------------------------------------
# 7. Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  MoneyTalks is running!" -ForegroundColor Green
Write-Host "  Local:     http://localhost:8502" -ForegroundColor Green
Write-Host "  Tailscale: http://$(hostname):8502" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

if ($Full) {
    Write-Warn "-Full flag set: trigger a full Plaid sync from Settings > Sync after opening the app."
}
