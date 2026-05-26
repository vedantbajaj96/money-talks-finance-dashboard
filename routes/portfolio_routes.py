"""routes/portfolio_routes.py — /api/portfolio/* endpoints.

Parses Wealthfront monthly statements to compute:
- Contribution history and total fees paid
- Time-weighted return (TWR)
- Beta and alpha vs SPY benchmark
"""
from __future__ import annotations

import datetime
import logging
import re
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.store import load_config

logger = logging.getLogger(__name__)
router = APIRouter()

# Default statements directory — can be overridden via user config key "statements_dir"
_DEFAULT_STATEMENTS_DIR = Path.home() / "Statements"


def _statements_dir(cfg: dict) -> Path:
    return Path(cfg.get("statements_dir") or _DEFAULT_STATEMENTS_DIR)


def _parse_statements(statements_dir: Path) -> list[dict]:
    """Parse all STATEMENT_*.pdf files and return sorted list of monthly dicts."""
    try:
        import pdfplumber  # noqa: PLC0415
    except ImportError:
        raise RuntimeError("pdfplumber not installed — run: pip install pdfplumber")

    pdfs = sorted(statements_dir.glob("STATEMENT_*.pdf"))
    results = []

    for pdf_path in pdfs:
        m = re.search(r"STATEMENT_(\d{4}-\d{2})", pdf_path.name)
        if not m:
            continue
        month = m.group(1)

        text = ""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text += t + "\n"
        except Exception as e:
            logger.warning("Could not read %s: %s", pdf_path.name, e)
            continue

        start_m = re.search(r"Starting Balance\s+\$([\d,]+\.\d{2})", text)
        end_m   = re.search(r"Ending Balance\s+\$([\d,]+\.\d{2})", text)
        dep_total_m = re.search(
            r"Deposits/Credits to Wealthfront Brokerage.*?Total\s+\$([\d,]+\.\d{2})",
            text, re.DOTALL,
        )
        fee_m = re.search(r"Wealthfront Advisory Fee\b.*?\$([\d,]+\.\d{2})", text)

        # Individual deposit lines for timeline
        deposits_detail: list[dict] = []
        dep_section_m = re.search(
            r"Deposits/Credits to Wealthfront Brokerage(.*?)(?:Withdrawals|TRANSFERS|FEES|$)",
            text, re.DOTALL,
        )
        if dep_section_m:
            for dm in re.finditer(
                r"(\d{1,2}/\d{1,2}/\d{4})\s+\S+\s+\S+\s+\$([\d,]+\.\d{2})",
                dep_section_m.group(1),
            ):
                deposits_detail.append({
                    "date":   dm.group(1),
                    "amount": float(dm.group(2).replace(",", "")),
                })

        results.append({
            "month":           month,
            "start_balance":   float(start_m.group(1).replace(",", "")) if start_m else 0.0,
            "end_balance":     float(end_m.group(1).replace(",", "")) if end_m else 0.0,
            "deposits":        float(dep_total_m.group(1).replace(",", "")) if dep_total_m else 0.0,
            "fee":             float(fee_m.group(1).replace(",", "")) if fee_m else 0.0,
            "deposits_detail": deposits_detail,
        })

    return results


def _compute_performance(statements: list[dict]) -> dict:
    """Compute TWR, beta, alpha vs SPY from monthly statement data."""
    try:
        import yfinance as yf  # noqa: PLC0415
        from scipy import stats  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(f"Missing dependency: {e}")

    if not statements:
        return {}

    # ── Monthly sub-period returns (Modified Dietz, deposits assumed end of month) ──
    # Skip month 0: start_balance=0 (account inception with E*Trade transfer in).
    # From month 1 onward: start_balance is well-defined.
    monthly_returns: list[dict] = []
    for s in statements[1:]:  # skip inception month
        start = s["start_balance"]
        end   = s["end_balance"]
        deps  = s["deposits"]
        # Denominator: opening balance + new cash (worst case: deposited at start)
        denom = start + deps
        if denom > 0:
            r = end / denom - 1
            monthly_returns.append({"month": s["month"], "portfolio": round(r * 100, 4)})

    if not monthly_returns:
        return {}

    # ── Fetch SPY monthly returns via yfinance ──
    first_month = monthly_returns[0]["month"]
    start_date  = f"{first_month}-01"
    end_date    = datetime.date.today().isoformat()

    spy_monthly: dict[str, float] = {}
    try:
        spy = yf.download(
            "SPY", start=start_date, end=end_date,
            interval="1mo", progress=False, auto_adjust=True,
        )
        if not spy.empty:
            # Handle multi-level columns from newer yfinance
            close = spy["Close"] if "Close" in spy.columns else spy.iloc[:, 3]
            if hasattr(close, "columns"):  # MultiIndex — pick first ticker
                close = close.iloc[:, 0]
            pct = close.pct_change().dropna()
            for idx, val in pct.items():
                m = idx.strftime("%Y-%m")
                if not np.isnan(val):
                    spy_monthly[m] = round(float(val) * 100, 4)
    except Exception as e:
        logger.warning("Could not fetch SPY data: %s", e)

    # ── Align for regression ──
    port_arr: list[float] = []
    spy_arr:  list[float] = []
    for mr in monthly_returns:
        if mr["month"] in spy_monthly:
            mr["spy"] = spy_monthly[mr["month"]]
            port_arr.append(mr["portfolio"])
            spy_arr.append(mr["spy"])
        else:
            mr["spy"] = None

    beta = alpha = r_squared = None
    if len(port_arr) >= 6:
        slope, intercept, r_val, _, _ = stats.linregress(spy_arr, port_arr)
        beta      = round(float(slope), 3)
        alpha     = round(float(intercept) * 12, 2)   # annualized alpha in % pts
        r_squared = round(float(r_val) ** 2, 3)

    # ── TWR (chain monthly returns) ──
    twr_port = 1.0
    twr_spy  = 1.0
    for mr in monthly_returns:
        twr_port *= 1 + mr["portfolio"] / 100
        if mr.get("spy") is not None:
            twr_spy *= 1 + mr["spy"] / 100

    return {
        "monthly_returns": monthly_returns,
        "twr_portfolio":   round((twr_port - 1) * 100, 2),
        "twr_spy":         round((twr_spy  - 1) * 100, 2),
        "beta":            beta,
        "alpha":           alpha,
        "r_squared":       r_squared,
    }


@router.post("/api/notifications/test")
async def test_notification(current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    from core.notifier import send_test_email
    cfg       = load_config(current_user)
    email     = cfg.get("alert_email", "").strip()
    smtp_pass = cfg.get("alert_smtp_password", "").strip()
    if not email or not smtp_pass:
        raise HTTPException(400, "Configure alert_email and alert_smtp_password in Settings first.")
    try:
        send_test_email(to=email, smtp_password=smtp_pass)
        return {"ok": True, "sent_to": email}
    except Exception as e:
        raise HTTPException(500, f"Email failed: {e}")


@router.get("/api/portfolio/performance")
def portfolio_performance(current_user: str = Depends(get_current_user)) -> dict[str, Any]:
    cfg   = load_config(current_user)
    sdir  = _statements_dir(cfg)

    if not sdir.exists():
        return {
            "ok": False,
            "error": f"Statements directory not found: {sdir}. "
                     "Set 'statements_dir' in Settings or place PDFs in ~/Statements.",
            "statements": [],
        }

    try:
        statements = _parse_statements(sdir)
    except Exception as e:
        raise HTTPException(500, str(e))

    if not statements:
        return {"ok": True, "statements": [], "performance": {}}

    # Aggregate totals
    total_deposits = sum(s["deposits"] for s in statements)
    total_fees     = sum(s["fee"] for s in statements)
    all_deposits   = [d for s in statements for d in s["deposits_detail"]]

    # Monthly balance history for chart
    balances = [{"month": s["month"], "value": s["end_balance"]} for s in statements]

    # Current (latest) portfolio value
    current_value = statements[-1]["end_balance"]

    # Transfer-in from E*Trade (inception month: end - cash deposits)
    inception = statements[0]
    transfer_in = inception["end_balance"] - inception["deposits"]

    try:
        perf = _compute_performance(statements)
    except Exception as e:
        logger.warning("Performance calculation failed: %s", e)
        perf = {"error": str(e)}

    return {
        "ok":               True,
        "total_deposits":   total_deposits,
        "transfer_in":      round(transfer_in, 2),
        "total_invested":   round(total_deposits + transfer_in, 2),
        "total_fees":       round(total_fees, 2),
        "current_value":    current_value,
        "all_deposits":     sorted(all_deposits, key=lambda d: d["date"]),
        "balances":         balances,
        "performance":      perf,
        "statement_count":  len(statements),
    }
