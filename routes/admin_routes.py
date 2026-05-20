import uuid
import subprocess
import threading
import time
import os
import sys
from fastapi import APIRouter, Depends
from core.auth import get_admin_user
from core.store import load_config

router = APIRouter()

# In-memory job store: { job_id: { "output": str, "done": bool, "ok": bool } }
_jobs: dict[str, dict] = {}


def _run_job(job_id: str, cmd: list[str], cwd: str | None = None):
    job = _jobs[job_id]
    try:
        proc = subprocess.Popen(
            cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        for line in proc.stdout:
            job["output"] += line
        proc.wait()
        job["ok"] = proc.returncode == 0
    except Exception as e:
        job["output"] += f"\n[ERROR] {e}"
        job["ok"] = False
    job["done"] = True


@router.get("/api/admin/health")
def get_health(current_user: str = Depends(get_admin_user)):
    """Check subsystem health: DB access, AI key, search model."""
    checks = []

    # DB / data directory
    data_dir = os.path.join("data", current_user)
    checks.append({
        "name": "Data directory",
        "ok": os.path.isdir(data_dir),
        "detail": data_dir,
    })

    # Transactions parquet
    txn_file = os.path.join(data_dir, "transactions.parquet")
    checks.append({
        "name": "Transactions DB",
        "ok": os.path.isfile(txn_file),
        "detail": f"{os.path.getsize(txn_file) // 1024} KB" if os.path.isfile(txn_file) else "file not found",
    })

    # AI key
    cfg = load_config(current_user)
    provider = cfg.get("preferred_provider", "claude")
    if provider == "gemini":
        has_key = bool(cfg.get("gemini_api_key"))
    else:
        has_key = bool(cfg.get("anthropic_api_key"))
    checks.append({
        "name": f"AI key ({provider})",
        "ok": has_key,
        "detail": "configured" if has_key else "not set",
    })

    # Sentence-transformer model
    try:
        from core.search import _sem_model
        model_ok = _sem_model is not None
        model_name = getattr(_sem_model, "_model_card_data", {}).get("base_model", "loaded") if model_ok else "not loaded"
        checks.append({"name": "Search model", "ok": model_ok, "detail": "loaded"})
    except Exception as e:
        checks.append({"name": "Search model", "ok": False, "detail": str(e)})

    # Docker (are we inside a container?)
    in_docker = os.path.isfile("/.dockerenv")
    checks.append({
        "name": "Docker environment",
        "ok": in_docker,
        "detail": "running in container" if in_docker else "local dev mode",
    })

    return {"checks": checks}


@router.post("/api/admin/deploy")
def trigger_deploy(current_user: str = Depends(get_admin_user)):
    """Run git pull + docker compose up -d --build in the background."""
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"output": "", "done": False, "ok": False, "type": "deploy"}

    # Detect project root (where docker-compose.yml lives)
    cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    cmd = ["bash", "-c", "docker compose pull && docker compose up -d"]
    t = threading.Thread(target=_run_job, args=(job_id, cmd, cwd), daemon=True)
    t.start()
    return {"job_id": job_id}


_TEST_SUITES = {
    "unit":        [sys.executable, "-m", "pytest", "tests/test_categorization.py", "tests/test_session_store.py", "-v"],
    "integration": [sys.executable, "-m", "pytest", "tests/test_build_fin_data.py", "tests/test_plaid_client.py", "-v"],
    "search":      [sys.executable, "eval_search.py"],
    "all":         [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short"],
}


@router.post("/api/admin/test/{suite}")
def trigger_tests(suite: str, current_user: str = Depends(get_admin_user)):
    """Run a named test suite in the background. suite: unit | integration | search | all"""
    if suite not in _TEST_SUITES:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unknown suite: {suite}")

    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"output": "", "done": False, "ok": False, "type": f"test:{suite}"}

    cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    # For "all", run pytest first then append search eval output
    if suite == "all":
        def _run_all(job_id, cwd):
            job = _jobs[job_id]
            for cmd in [
                [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short"],
                [sys.executable, "eval_search.py"],
            ]:
                label = "pytest tests/" if "pytest" in cmd else "eval_search.py"
                job["output"] += f"\n{'='*40}\n▶ {label}\n{'='*40}\n"
                try:
                    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True, bufsize=1)
                    for line in proc.stdout:
                        job["output"] += line
                    proc.wait()
                    if proc.returncode != 0:
                        job["ok"] = False
                        job["output"] += f"\n[exited {proc.returncode}]\n"
                except Exception as e:
                    job["output"] += f"\n[ERROR] {e}\n"
                    job["ok"] = False
            job["done"] = True
            if "ok" not in job or job["ok"] is False:
                pass  # already set
            else:
                job["ok"] = True
        _jobs[job_id]["ok"] = True  # optimistic; _run_all sets False on failure
        t = threading.Thread(target=_run_all, args=(job_id, cwd), daemon=True)
    else:
        t = threading.Thread(target=_run_job, args=(job_id, _TEST_SUITES[suite], cwd), daemon=True)

    t.start()
    return {"job_id": job_id}


@router.get("/api/admin/job/{job_id}")
def get_job(job_id: str, current_user: str = Depends(get_admin_user)):
    job = _jobs.get(job_id)
    if not job:
        return {"error": "job not found"}
    return {"output": job["output"], "done": job["done"], "ok": job["ok"], "type": job.get("type")}


@router.get("/api/admin/logs")
def get_logs(lines: int = 200, current_user: str = Depends(get_admin_user)):
    """Return the last N lines of server.log."""
    log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "server.log"))
    if not os.path.isfile(log_path):
        return {"lines": [], "error": "server.log not found"}
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        return {"lines": [l.rstrip("\n") for l in all_lines[-lines:]]}
    except Exception as e:
        return {"lines": [], "error": str(e)}
