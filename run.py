"""
run.py — Start the Finance Dashboard (Streamlit + Plaid gateway together).

Usage:
  python3 run.py

This starts:
  • Streamlit app  on http://localhost:8501
  • Plaid gateway  on http://localhost:8502

The Plaid gateway handles Plaid Link authentication and redirects back to
Streamlit after a bank account is successfully connected.
"""

import subprocess
import sys
import threading

import uvicorn


def _run_plaid_server() -> None:
    uvicorn.run(
        "plaid_server:app",
        host="localhost",
        port=8502,
        log_level="warning",   # keep output quiet; Streamlit logs dominate
    )


def _run_streamlit() -> None:
    subprocess.run(
        [sys.executable, "-m", "streamlit", "run", "app.py",
         "--server.port", "8501",
         "--server.headless", "false"],
    )


if __name__ == "__main__":
    # Start the Plaid gateway in a background thread
    plaid_thread = threading.Thread(target=_run_plaid_server, daemon=True)
    plaid_thread.start()

    print("Plaid gateway running on http://localhost:8502")
    print("Starting Streamlit on http://localhost:8501 ...")

    # Run Streamlit in the main thread (blocks until user quits)
    _run_streamlit()
