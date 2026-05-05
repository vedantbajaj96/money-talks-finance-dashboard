"""
app.py — Personal Finance Dashboard entry point.

Run with:  streamlit run app.py

Stage routing:
  upload       → stages/upload.py
  sanity_check → stages/sanity_check.py
  dashboard    → stages/dashboard.py
"""

import os

import streamlit as st

from config import load_config
from stages.dashboard import show_dashboard_stage
from stages.sanity_check import show_sanity_check_stage
from stages.upload import show_upload_stage
from storage import load_transactions

# ---------------------------------------------------------------------------
# Page config — must be the very first Streamlit call
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Finance Dashboard",
    page_icon="💰",
    layout="wide",
)

# ---------------------------------------------------------------------------
# Session state defaults — set once on first load
# ---------------------------------------------------------------------------
if "stage" not in st.session_state:
    st.session_state["stage"] = "upload"

if "df_transactions" not in st.session_state:
    st.session_state["df_transactions"] = None

if "pending_overrides" not in st.session_state:
    st.session_state["pending_overrides"] = {}

# If no transactions in session yet, try loading from disk.
# This means a page refresh resumes the dashboard instead of the upload screen.
if st.session_state["df_transactions"] is None:
    _persisted = load_transactions()
    if _persisted is not None:
        st.session_state["df_transactions"] = _persisted
        if st.session_state["stage"] == "upload":
            st.session_state["stage"] = "dashboard"
    else:
        # No saved transactions — if Plaid accounts are connected, auto-sync
        # on first load so the user lands on the dashboard without any manual step.
        from plaid_client import get_connected_accounts, is_configured as plaid_is_configured, sync_all_transactions
        if plaid_is_configured() and get_connected_accounts():
            from categorizer import categorize_transactions
            from stages.upload import _filter_and_label, _run_llm
            from storage import save_transactions
            _new_df = sync_all_transactions()
            if not _new_df.empty:
                _new_df = categorize_transactions(_new_df)
                _new_df = _filter_and_label(_new_df)
                save_transactions(_new_df)
                st.session_state["df_transactions"] = _new_df
                st.session_state["stage"] = "dashboard"

# Load persisted API keys — config.json wins over environment variable
_cfg = load_config()

if "anthropic_api_key" not in st.session_state:
    st.session_state["anthropic_api_key"] = (
        _cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
    )
if "gemini_api_key" not in st.session_state:
    st.session_state["gemini_api_key"] = _cfg.get("gemini_api_key", "")

if "preferred_provider" not in st.session_state:
    st.session_state["preferred_provider"] = _cfg.get("preferred_provider", "claude")

if "plaid_client_id" not in st.session_state:
    st.session_state["plaid_client_id"] = _cfg.get("plaid_client_id", "")
if "plaid_secret" not in st.session_state:
    st.session_state["plaid_secret"] = _cfg.get("plaid_secret", "")
if "plaid_environment" not in st.session_state:
    st.session_state["plaid_environment"] = _cfg.get("plaid_environment", "sandbox")

# ---------------------------------------------------------------------------
# Privacy notice — shown on every stage
# ---------------------------------------------------------------------------
st.info(
    "🔒 **Your data never leaves this machine.** "
    "All processing happens locally. Nothing is stored or transmitted."
)

# ---------------------------------------------------------------------------
# Stage router
# ---------------------------------------------------------------------------
_STAGE_RENDERERS = {
    "upload":       show_upload_stage,
    "sanity_check": show_sanity_check_stage,
    "dashboard":    show_dashboard_stage,
}

_STAGE_RENDERERS.get(st.session_state["stage"], show_upload_stage)()
